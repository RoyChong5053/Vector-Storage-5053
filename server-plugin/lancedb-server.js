/**
 * LanceDB Server Implementation
 * Handles vector storage with LanceDB + embedding
 */

import lancedb from '@lancedb/lancedb';

/**
 * @typedef {Object} VectorItem
 * @property {number} hash - Unique hash identifier
 * @property {string} text - Text content
 * @property {number} index - Position index
 * @property {object} metadata - Additional metadata
 */

/**
 * @typedef {Object} VectorQueryResult
 * @property {number[]} hashes - Matching hash IDs
 * @property {object[]} metadata - Matching metadata entries
 */

// LanceDB connection singleton
let lancedbConnection = null;
let lancedbClient = null;

/**
 * Get or create LanceDB connection
 * @returns {Promise<{client: any, db: any}>}
 */
export async function lanceDB() {
    if (lancedbConnection) {
        return lancedbConnection;
    }

    const dbPath = process.env.LANCEDB_PATH || './data/vectors.lancedb';

    try {
        const fs = await import('fs');
        const path = await import('path');
        const dir = path.dirname(dbPath);
        if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        lancedbClient = await lancedb.connect(dbPath);
        lancedbConnection = {
            client: lancedbClient,
            db: lancedbClient,
        };

        console.log('[LanceDB] Connected to database at', dbPath);
        return lancedbConnection;
    } catch (error) {
        console.error('[LanceDB] Connection failed:', error);
        throw error;
    }
}

/**
 * VectorStorage class for managing vector operations
 */
export class VectorStorage {
    constructor(db, table) {
        this.db = db;
        this.table = table;
    }

    /**
     * Create VectorStorage instance
     * @returns {Promise<VectorStorage>}
     */
    static async create() {
        const { db } = await lanceDB();
        return new VectorStorage(db, null);
    }

    /**
     * Get or create a table for a collection
     * @param {string} collectionId
     * @returns {Promise<any>}
     */
    async getTable(collectionId) {
        const tableName = this.sanitizeTableName(collectionId);

        try {
            // Check if table exists
            const tables = await this.db.tableNames();
            if (!tables.includes(tableName)) {
                // Create table with schema
                await this.db.createTable(tableName, {
                    vector: 'vector',    // Vector dimension (will be set on first insert)
                    hash: 'int64',       // Hash identifier
                    text: 'string',      // Text content
                    index: 'int32',      // Position index
                    metadata: 'json',     // Additional metadata
                });
            }

            return this.db.openTable(tableName);
        } catch (error) {
            console.error('[VectorStorage] Table error:', error);
            throw error;
        }
    }

    /**
     * Sanitize table name (LanceDB tables can't have special chars)
     * @param {string} name
     * @returns {string}
     */
    sanitizeTableName(name) {
        return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 128);
    }

    /**
     * Insert items into a collection
     * @param {string} collectionId
     * @param {VectorItem[]} items
     * @returns {Promise<number>}
     */
    async insert(collectionId, items) {
        const table = await this.getTable(collectionId);

        // Generate embeddings for items
        const embeddings = await this.generateEmbeddings(items.map(i => i.text));

        const records = items.map((item, i) => ({
            vector: embeddings[i],
            hash: item.hash,
            text: item.text,
            index: item.index,
            metadata: item.metadata || {},
        }));

        await table.add(records);
        return records.length;
    }

    /**
     * Query similar items
     * @param {string} collectionId
     * @param {string} queryText
     * @param {number} topK
     * @param {number} threshold
     * @returns {Promise<VectorQueryResult>}
     */
    async query(collectionId, queryText, topK = 10, threshold = 0.0) {
        const table = await this.getTable(collectionId);

        // Generate embedding for query
        const [embedding] = await this.generateEmbeddings([queryText]);

        // Search
        const results = await table.search(embedding, 'vector')
            .limit(topK)
            .where(`_score >= ${threshold}`)
            .toArray();

        return {
            hashes: results.map(r => r.hash),
            metadata: results.map(r => ({
                text: r.text,
                index: r.index,
                score: r._score,
                ...r.metadata,
            })),
        };
    }

    /**
     * Delete items by hash
     * @param {string} collectionId
     * @param {number[]} hashes
     * @returns {Promise<number>}
     */
    async delete(collectionId, hashes) {
        const table = await this.getTable(collectionId);

        // Build delete query
        const deleteCount = await table.delete()
            .where(`hash IN [${hashes.join(',')}]`)
            .execute();

        return deleteCount;
    }

    /**
     * List all hashes in collection
     * @param {string} collectionId
     * @returns {Promise<number[]>}
     */
    async list(collectionId) {
        try {
            const table = await this.getTable(collectionId);
            const results = await table.query().toArray();
            return results.map(r => r.hash);
        } catch (error) {
            // Table might not exist yet
            if (error.message?.includes('not found')) {
                return [];
            }
            throw error;
        }
    }

    /**
     * Get items by hashes
     * @param {string} collectionId
     * @param {number[]} hashes
     * @returns {Promise<VectorItem[]>}
     */
    async getByHashes(collectionId, hashes) {
        const table = await this.getTable(collectionId);

        const results = await table.query()
            .where(`hash IN [${hashes.join(',')}]`)
            .toArray();

        return results.map(r => ({
            hash: r.hash,
            text: r.text,
            index: r.index,
            metadata: r.metadata,
        }));
    }

    /**
     * Query multiple collections at once
     * @param {string[]} collectionIds
     * @param {string} queryText
     * @param {number} topK
     * @param {number} threshold
     * @returns {Promise<Record<string, VectorQueryResult>>}
     */
    async queryMultipleCollections(collectionIds, queryText, topK = 10, threshold = 0.0) {
        const results = {};

        for (const collectionId of collectionIds) {
            try {
                results[collectionId] = await this.query(collectionId, queryText, topK, threshold);
            } catch (error) {
                console.error(`[VectorStorage] QueryMulti error for ${collectionId}:`, error);
                results[collectionId] = { hashes: [], metadata: [] };
            }
        }

        return results;
    }

    /**
     * Purge entire collection
     * @param {string} collectionId
     */
    async purge(collectionId) {
        const tableName = this.sanitizeTableName(collectionId);

        try {
            const tables = await this.db.tableNames();
            if (tables.includes(tableName)) {
                await this.db.dropTable(tableName);
            }
        } catch (error) {
            console.error('[VectorStorage] Purge error:', error);
        }
    }

    /**
     * Purge all collections
     */
    async purgeAll() {
        try {
            const tables = await this.db.tableNames();
            for (const tableName of tables) {
                await this.db.dropTable(tableName);
            }
        } catch (error) {
            console.error('[VectorStorage] PurgeAll error:', error);
        }
    }

    /**
     * Generate embeddings using configured provider
     * @param {string[]} texts
     * @returns {Promise<number[][]>}
     */
    async generateEmbeddings(texts) {
        // Use SillyTavern's built-in embedding API
        // This calls the official vector storage API
        try {
            const response = await fetch('http://localhost:3000/api/vector/embed', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    texts: texts,
                    source: 'transformers', // or from config
                }),
            });

            if (response.ok) {
                const data = await response.json();
                return data.embeddings;
            }
        } catch (error) {
            console.warn('[VectorStorage] Embedding API fallback, using mock embeddings');
        }

        // Fallback: return mock embeddings for testing
        // In production, this should use a real embedding provider
        return texts.map(() => new Array(384).fill(0).map(() => Math.random()));
    }
}