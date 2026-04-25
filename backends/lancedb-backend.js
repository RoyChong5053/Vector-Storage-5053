import { VectorBackend } from './backend-interface.js';

/**
 * LanceDB backend - communicates with server plugin via HTTP
 * Based on UwU-Memory architecture
 */
export class LanceDBBackend extends VectorBackend {
    constructor(settings = {}) {
        super(settings);
        this.getRequestHeaders = null;
    }

    /**
     * Initialize with request headers function
     * @param {Function} getRequestHeadersFn - Function to get request headers
     */
    init(getRequestHeadersFn) {
        this.getRequestHeaders = getRequestHeadersFn;
    }

    /**
     * Get backend name
     * @returns {string}
     */
    getName() {
        return 'lancedb';
    }

    /**
     * Get headers for JSON requests
     * @returns {object}
     */
    getJsonHeaders() {
        const baseHeaders = this.getRequestHeaders ? this.getRequestHeaders() : {};
        return {
            ...baseHeaders,
            'Content-Type': 'application/json',
        };
    }

    /**
     * Insert items into LanceDB
     * @param {string} collectionId
     * @param {Array} items - Items with hash, text, index, metadata
     * @returns {Promise<{success: boolean, inserted: number}>}
     */
    async insert(collectionId, items) {
        if (!this.getRequestHeaders) {
            throw new Error('LanceDBBackend not initialized');
        }

        const response = await fetch('/api/plugins/uwu-memory/insert', {
            method: 'POST',
            headers: this.getJsonHeaders(),
            body: JSON.stringify({
                collectionId,
                items: items.map(item => ({
                    hash: item.hash,
                    text: item.text,
                    index: item.index,
                    metadata: item.metadata || {},
                })),
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(error.error || `Insert failed: ${response.status}`);
        }

        const result = await response.json();
        return { success: true, inserted: result.inserted };
    }

    /**
     * Query LanceDB for similar items
     * @param {string} collectionId
     * @param {string} queryText
     * @param {number} topK
     * @param {number} threshold
     * @returns {Promise<{hashes: number[], metadata: object[]}>}
     */
    async query(collectionId, queryText, topK, threshold) {
        if (!this.getRequestHeaders) {
            throw new Error('LanceDBBackend not initialized');
        }

        const response = await fetch('/api/plugins/uwu-memory/query', {
            method: 'POST',
            headers: this.getJsonHeaders(),
            body: JSON.stringify({
                collectionId,
                queryText,
                topK,
                threshold: threshold ?? 0.0,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(error.error || `Query failed: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Delete items from LanceDB
     * @param {string} collectionId
     * @param {number[]} hashes
     * @returns {Promise<{success: boolean, deleted: number}>}
     */
    async delete(collectionId, hashes) {
        if (!this.getRequestHeaders) {
            throw new Error('LanceDBBackend not initialized');
        }

        const response = await fetch('/api/plugins/uwu-memory/delete', {
            method: 'POST',
            headers: this.getJsonHeaders(),
            body: JSON.stringify({ collectionId, hashes }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(error.error || `Delete failed: ${response.status}`);
        }

        const result = await response.json();
        return { success: true, deleted: result.deleted };
    }

    /**
     * List all hashes in collection
     * @param {string} collectionId
     * @returns {Promise<number[]>}
     */
    async list(collectionId) {
        if (!this.getRequestHeaders) {
            throw new Error('LanceDBBackend not initialized');
        }

        try {
            const response = await fetch('/api/plugins/uwu-memory/list', {
                method: 'POST',
                headers: this.getJsonHeaders(),
                body: JSON.stringify({ collectionId }),
            });

            if (response.status === 404) {
                return [];
            }

            if (!response.ok) {
                throw new Error(`List failed: ${response.status}`);
            }

            const result = await response.json();
            return result.hashes || [];
        } catch (error) {
            console.error('LanceDBBackend list error:', error);
            return [];
        }
    }

    /**
     * Get items by hashes
     * @param {string} collectionId
     * @param {number[]} hashes
     * @returns {Promise<Array>}
     */
    async getByHashes(collectionId, hashes) {
        if (!this.getRequestHeaders) {
            throw new Error('LanceDBBackend not initialized');
        }

        if (!hashes?.length) {
            return [];
        }

        try {
            const response = await fetch('/api/plugins/uwu-memory/getByHashes', {
                method: 'POST',
                headers: this.getJsonHeaders(),
                body: JSON.stringify({ collectionId, hashes }),
            });

            if (response.status === 404) {
                return [];
            }

            if (!response.ok) {
                throw new Error(`GetByHashes failed: ${response.status}`);
            }

            const result = await response.json();
            return result.items || [];
        } catch (error) {
            console.error('LanceDBBackend getByHashes error:', error);
            return [];
        }
    }

    /**
     * Purge a collection
     * @param {string} collectionId
     * @returns {Promise<{success: boolean}>}
     */
    async purge(collectionId) {
        if (!this.getRequestHeaders) {
            throw new Error('LanceDBBackend not initialized');
        }

        const response = await fetch('/api/plugins/uwu-memory/purge', {
            method: 'POST',
            headers: this.getJsonHeaders(),
            body: JSON.stringify({ collectionId }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(error.error || `Purge failed: ${response.status}`);
        }

        return { success: true };
    }

    /**
     * Purge all collections
     * @returns {Promise<{success: boolean}>}
     */
    async purgeAll() {
        if (!this.getRequestHeaders) {
            throw new Error('LanceDBBackend not initialized');
        }

        const response = await fetch('/api/plugins/uwu-memory/purge-all', {
            method: 'POST',
            headers: this.getJsonHeaders(),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(error.error || `PurgeAll failed: ${response.status}`);
        }

        return { success: true };
    }

    /**
     * Query multiple collections at once
     * @param {string[]} collectionIds
     * @param {string} queryText
     * @param {number} topK
     * @param {number} threshold
     * @returns {Promise<Record<string, {hashes: number[], metadata: object[]}>>}
     */
    async queryMultipleCollections(collectionIds, queryText, topK, threshold) {
        if (!this.getRequestHeaders) {
            throw new Error('LanceDBBackend not initialized');
        }

        const response = await fetch('/api/plugins/uwu-memory/query-multi', {
            method: 'POST',
            headers: this.getJsonHeaders(),
            body: JSON.stringify({
                collectionIds,
                queryText,
                topK,
                threshold: threshold ?? 0.0,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(error.error || `QueryMulti failed: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Health check
     * @returns {Promise<{healthy: boolean, message?: string}>}
     */
    async healthCheck() {
        if (!this.getRequestHeaders) {
            return { healthy: false, message: 'Not initialized' };
        }

        try {
            const response = await fetch('/api/plugins/uwu-memory/health', {
                method: 'GET',
                headers: this.getRequestHeaders(),
            });

            if (response.ok) {
                const result = await response.json();
                return { healthy: true, message: `OK (${result.backend})` };
            }

            return { healthy: false, message: `Status: ${response.status}` };
        } catch (error) {
            return { healthy: false, message: error.message };
        }
    }
}