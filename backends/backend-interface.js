/**
 * Abstract base class for vector storage backends
 */
export class VectorBackend {
    constructor(settings) {
        this.settings = settings;
    }

    /**
     * Insert items into the vector store
     * @param {string} collectionId - Collection identifier
     * @param {Array<{hash: number, text: string, index: number, metadata?: object}>} items - Items to insert
     * @returns {Promise<{success: boolean, inserted: number}>}
     */
    async insert(collectionId, items) {
        throw new Error('Not implemented');
    }

    /**
     * Query similar items from the vector store
     * @param {string} collectionId - Collection identifier
     * @param {string} queryText - Text to search for
     * @param {number} topK - Number of results to return
     * @param {number} threshold - Minimum similarity threshold
     * @returns {Promise<{hashes: number[], metadata: object[]}>}
     */
    async query(collectionId, queryText, topK, threshold) {
        throw new Error('Not implemented');
    }

    /**
     * Delete items by hash
     * @param {string} collectionId - Collection identifier
     * @param {number[]} hashes - Hashes to delete
     * @returns {Promise<{success: boolean, deleted: number}>}
     */
    async delete(collectionId, hashes) {
        throw new Error('Not implemented');
    }

    /**
     * List all hashes in collection
     * @param {string} collectionId - Collection identifier
     * @returns {Promise<number[]>}
     */
    async list(collectionId) {
        throw new Error('Not implemented');
    }

    /**
     * Get items by hashes
     * @param {string} collectionId - Collection identifier
     * @param {number[]} hashes - Hashes to retrieve
     * @returns {Promise<Array<{hash: number, text: string, index: number, metadata?: object}>>}
     */
    async getByHashes(collectionId, hashes) {
        throw new Error('Not implemented');
    }

    /**
     * Purge entire collection
     * @param {string} collectionId - Collection identifier
     * @returns {Promise<{success: boolean}>}
     */
    async purge(collectionId) {
        throw new Error('Not implemented');
    }

    /**
     * Purge all collections
     * @returns {Promise<{success: boolean}>}
     */
    async purgeAll() {
        throw new Error('Not implemented');
    }

    /**
     * Query multiple collections at once
     * @param {string[]} collectionIds - Collection identifiers
     * @param {string} queryText - Text to search for
     * @param {number} topK - Number of results per collection
     * @param {number} threshold - Minimum similarity threshold
     * @returns {Promise<Record<string, {hashes: number[], metadata: object[]}>>}
     */
    async queryMultipleCollections(collectionIds, queryText, topK, threshold) {
        throw new Error('Not implemented');
    }

    /**
     * Health check
     * @returns {Promise<{healthy: boolean, message?: string}>}
     */
    async healthCheck() {
        throw new Error('Not implemented');
    }

    /**
     * Get backend name
     * @returns {string}
     */
    getName() {
        throw new Error('Not implemented');
    }
}