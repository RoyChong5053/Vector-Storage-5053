/**
 * Server-side plugin for Vector Storage - LanceDB Edition
 * 
 * This plugin exposes LanceDB API endpoints for the browser extension to use.
 * It provides a lightweight Express-based server that handles vector storage operations.
 */

import express from 'express';
import { lanceDB } from './lancedb-server.js';
import { VectorStorage } from './vector-storage-server.js';

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());

/**
 * Health check endpoint
 */
app.get('/api/plugins/uwu-memory/health', async (req, res) => {
    try {
        const backend = await lanceDB();
        res.json({
            backend: 'lancedb',
            version: '0.11.0',
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

/**
 * Insert vectors
 */
app.post('/api/plugins/uwu-memory/insert', async (req, res) => {
    try {
        const { collectionId, items } = req.body;
        
        if (!collectionId || !Array.isArray(items) || items.length === 0) {
            res.status(400).json({
                error: 'Invalid request body',
            });
            return;
        }

        // Process items
        const processedItems = items.map(item => ({
            hash: item.hash,
            text: item.text,
            index: item.index,
            metadata: item.metadata || {},
        }));

        // Insert into LanceDB
        const storage = await VectorStorage.create();
        await storage.insert(collectionId, processedItems);

        res.json({
            inserted: processedItems.length,
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

/**
 * Query vectors
 */
app.post('/api/plugins/uwu-memory/query', async (req, res) => {
    try {
        const { collectionId, queryText, topK, threshold } = req.body;

        if (!collectionId || !queryText) {
            res.status(400).json({
                error: 'Invalid request body',
            });
            return;
        }

        // Query from LanceDB
        const storage = await VectorStorage.create();
        const results = await storage.query(collectionId, queryText, topK, threshold);

        res.json({
            results,
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

/**
 * List hashes
 */
app.post('/api/plugins/uwu-memory/list', async (req, res) => {
    try {
        const { collectionId } = req.body;

        if (!collectionId) {
            res.status(400).json({
                error: 'Invalid request body',
            });
            return;
        }

        // List hashes from LanceDB
        const storage = await VectorStorage.create();
        const hashes = await storage.list(collectionId);

        res.json({
            hashes,
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

/**
 * Delete vectors
 */
app.post('/api/plugins/uwu-memory/delete', async (req, res) => {
    try {
        const { collectionId, hashes } = req.body;

        if (!collectionId || !Array.isArray(hashes) || hashes.length === 0) {
            res.status(400).json({
                error: 'Invalid request body',
            });
            return;
        }

        // Delete from LanceDB
        const storage = await VectorStorage.create();
        await storage.delete(collectionId, hashes);

        res.json({
            deleted: hashes.length,
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

/**
 * Purge collection
 */
app.post('/api/plugins/uwu-memory/purge', async (req, res) => {
    try {
        const { collectionId } = req.body;

        if (!collectionId) {
            res.status(400).json({
                error: 'Invalid request body',
            });
            return;
        }

        // Purge from LanceDB
        const storage = await VectorStorage.create();
        await storage.purge(collectionId);

        res.json({
            success: true,
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

/**
 * Get by hashes
 */
app.post('/api/plugins/uwu-memory/getByHashes', async (req, res) => {
    try {
        const { collectionId, hashes } = req.body;

        if (!collectionId || !Array.isArray(hashes) || hashes.length === 0) {
            res.status(400).json({
                error: 'Invalid request body',
            });
            return;
        }

        // Get by hashes from LanceDB
        const storage = await VectorStorage.create();
        const items = await storage.getByHashes(collectionId, hashes);

        res.json({
            items,
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

/**
 * Purge all
 */
app.post('/api/plugins/uwu-memory/purge-all', async (req, res) => {
    try {
        const storage = await VectorStorage.create();
        await storage.purgeAll();

        res.json({
            success: true,
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

/**
 * Query multi (for batch queries)
 */
app.post('/api/vector/query-multi', async (req, res) => {
    try {
        const { collectionIds, searchText, topK, threshold } = req.body;

        if (!Array.isArray(collectionIds) || !searchText) {
            res.status(400).json({
                error: 'Invalid request body',
            });
            return;
        }

        // Query multiple collections
        const storage = await VectorStorage.create();
        const results = await storage.queryMultipleCollections(
            collectionIds,
            searchText,
            topK,
            threshold
        );

        res.json({
            results,
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`[Vectors-LanceDB] Server listening on port ${PORT}`);
    console.log(`[Vectors-LanceDB] API available at http://localhost:${PORT}/api/plugins/uwu-memory/`);
});

export { app };