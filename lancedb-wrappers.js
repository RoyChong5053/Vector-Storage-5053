/**
 * Gets the saved hashes for a collection
 * @param {string} collectionId
 * @returns {Promise<number[]>} Saved hashes
 */
async function getSavedHashes(collectionId) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            const hashes = await lancedbBackend.list(collectionId);
            if (hashes.length > 0) {
                console.log('Vectors: Using LanceDB backend');
                return hashes;
            }
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    // Fallback to official API
    const args = await getAdditionalArgs([]);
    const response = await fetch('/api/vector/list', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to get saved hashes for collection ${collectionId}`);
    }

    const hashes = await response.json();
    return hashes;
}

/**
 * Inserts vector items into a collection
 * @param {string} collectionId - The collection to insert into
 * @param {{ hash: number, text: string }[]} items - The items to insert
 * @returns {Promise<void>}
 */
async function insertVectorItems(collectionId, items) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.insert(collectionId, items);
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    throwIfSourceInvalid();

    const args = await getAdditionalArgs(items.map(x => x.text));
    const response = await fetch('/api/vector/insert', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            items: items,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to insert vector items for collection ${collectionId}`);
    }
}

/**
 * Deletes vector items from a collection
 * @param {string} collectionId - The collection to delete from
 * @param {number[]} hashes - The hashes of the items to delete
 * @returns {Promise<void>}
 */
async function deleteVectorItems(collectionId, hashes) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.delete(collectionId, hashes);
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const response = await fetch('/api/vector/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(),
            collectionId: collectionId,
            hashes: hashes,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to delete vector items for collection ${collectionId}`);
    }
}

/**
 * @param {string} collectionId - The collection to query
 * @param {string} searchText - The text to query
 * @param {number} topK - The number of results to return
 * @returns {Promise<{ hashes: number[], metadata: object[]}>} - Hashes of the results
 */
async function queryCollection(collectionId, searchText, topK) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            const results = await lancedbBackend.query(collectionId, searchText, topK, settings.score_threshold);
            if (results.length > 0) {
                console.log('Vectors: Using LanceDB backend');
                return results;
            }
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const args = await getAdditionalArgs([searchText]);
    const response = await fetch('/api/vector/query', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            searchText: searchText,
            topK: topK,
            source: settings.source,
            threshold: settings.score_threshold,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to query collection ${collectionId}`);
    }

    return await response.json();
}

/**
 * Queries multiple collections for a given text.
 * @param {string[]} collectionIds - The collection IDs to query
 * @param {string} searchText - The text to query
 * @param {number} topK - The number of results to return
 * @param {number} threshold - The threshold to use
 * @returns {Promise<{ hashes: number[], metadata: object[]}>} - Hashes of the results
 */
async function queryMultipleCollections(collectionIds, searchText, topK, threshold) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            const results = await lancedbBackend.queryMultipleCollections(collectionIds, searchText, topK, threshold);
            if (results.length > 0) {
                console.log('Vectors: Using LanceDB backend');
                return results;
            }
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const args = await getAdditionalArgs([searchText]);
    const response = await fetch('/api/vector/query-multi', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionIds: collectionIds,
            searchText: searchText,
            topK: topK,
            source: settings.source,
            threshold: threshold || settings.score_threshold,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to query multiple collections`);
    }

    return await response.json();
}

/**
 * Purges file vector index
 * @param {string} fileUrl - The URL of the file
 * @returns {Promise<void>}
 */
async function purgeFileVectorIndex(fileUrl) {
    const collectionId = getFileCollectionId(fileUrl);

    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.purge(collectionId);
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const response = await fetch('/api/vector/purge', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(),
            collectionId: collectionId,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to purge file vector index for ${fileUrl}`);
    }
}

/**
 * Purges vector index
 * @param {string} collectionId - The collection ID to purge
 * @returns {Promise<void>}
 */
async function purgeVectorIndex(collectionId) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.purge(collectionId);
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const response = await fetch('/api/vector/purge', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(),
            collectionId: collectionId,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to purge vector index for ${collectionId}`);
    }
}

/**
 * Purges all vector indexes
 * @returns {Promise<void>}
 */
async function purgeAllVectorIndexes() {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.purgeAll();
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const response = await fetch('/api/vector/purge-all', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(),
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to purge all vector indexes`);
    }
}

// Initialize LanceDB Backend
let lancedbBackend = null;

/**
 * Initializes the LanceDB backend if enabled
 */
async function initLanceDBBackend() {
    if (!settings.useLanceDB || !lancedbBackend) {
        return;
    }

    try {
        lancedbBackend = new LanceDBBackend({});
        lancedbBackend.init(getRequestHeaders);
        
        // Test connection
        const health = await lancedbBackend.healthCheck();
        if (health.healthy) {
            console.log('Vectors: LanceDB backend initialized successfully:', health.message);
        } else {
            console.warn('Vectors: LanceDB backend warning:', health.message);
        }
    } catch (error) {
        console.error('Vectors: Failed to initialize LanceDB backend:', error);
    }
}

// Export initialization function
window.initLanceDBBackend = initLanceDBBackend;
window.lancedbBackend = lancedbBackend;
window.lancedbBackendClass = LanceDBBackend;
window.VectorBackend = VectorBackend;
window.BackendFactory = BackendFactory;
