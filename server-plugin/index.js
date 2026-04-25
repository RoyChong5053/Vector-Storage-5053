/**
 * Vector Storage Server Plugin
 * LanceDB backend for SillyTavern Vector Storage extension
 */

import express from 'express';
import { lanceDB, VectorStorage } from './lancedb-server.js';

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());

/**
 * CORS headers for development
 */
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

/**
 * Health check
 */
app.get('/api/plugins/uwu-memory/health', async (req, res) => {
    try {
        const db = await lanceDB();
        const backend = db ? 'lancedb' : 'unavailable';
        res.json({
            backend,
            version: '1.0.0',
            status: db ? 'connected' : 'disconnected',
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

        if (!collectionId) {
            return res.status(400).json({ error: 'collectionId is required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items must be a non-empty array' });
        }

        const storage = await VectorStorage.create();
        const inserted = await storage.insert(collectionId, items);

        res.json({ success: true, inserted });
    } catch (error) {
        console.error('[VectorStorage] Insert error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Query vectors (similarity search)
 */
app.post('/api/plugins/uwu-memory/query', async (req, res) => {
    try {
        const { collectionId, queryText, topK = 10, threshold = 0.0 } = req.body;

        if (!collectionId) {
            return res.status(400).json({ error: 'collectionId is required' });
        }
        if (!queryText) {
            return res.status(400).json({ error: 'queryText is required' });
        }

        const storage = await VectorStorage.create();
        const results = await storage.query(collectionId, queryText, topK, threshold);

        res.json(results);
    } catch (error) {
        console.error('[VectorStorage] Query error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * List hashes in collection
 */
app.post('/api/plugins/uwu-memory/list', async (req, res) => {
    try {
        const { collectionId } = req.body;

        if (!collectionId) {
            return res.status(400).json({ error: 'collectionId is required' });
        }

        const storage = await VectorStorage.create();
        const hashes = await storage.list(collectionId);

        res.json({ hashes });
    } catch (error) {
        console.error('[VectorStorage] List error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Delete vectors by hash
 */
app.post('/api/plugins/uwu-memory/delete', async (req, res) => {
    try {
        const { collectionId, hashes } = req.body;

        if (!collectionId) {
            return res.status(400).json({ error: 'collectionId is required' });
        }
        if (!Array.isArray(hashes) || hashes.length === 0) {
            return res.status(400).json({ error: 'hashes must be a non-empty array' });
        }

        const storage = await VectorStorage.create();
        const deleted = await storage.delete(collectionId, hashes);

        res.json({ success: true, deleted });
    } catch (error) {
        console.error('[VectorStorage] Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Purge entire collection
 */
app.post('/api/plugins/uwu-memory/purge', async (req, res) => {
    try {
        const { collectionId } = req.body;

        if (!collectionId) {
            return res.status(400).json({ error: 'collectionId is required' });
        }

        const storage = await VectorStorage.create();
        await storage.purge(collectionId);

        res.json({ success: true });
    } catch (error) {
        console.error('[VectorStorage] Purge error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get items by hashes
 */
app.post('/api/plugins/uwu-memory/getByHashes', async (req, res) => {
    try {
        const { collectionId, hashes } = req.body;

        if (!collectionId) {
            return res.status(400).json({ error: 'collectionId is required' });
        }
        if (!Array.isArray(hashes) || hashes.length === 0) {
            return res.status(400).json({ error: 'hashes must be a non-empty array' });
        }

        const storage = await VectorStorage.create();
        const items = await storage.getByHashes(collectionId, hashes);

        res.json({ items });
    } catch (error) {
        console.error('[VectorStorage] GetByHashes error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Query multiple collections at once
 */
app.post('/api/plugins/uwu-memory/query-multi', async (req, res) => {
    try {
        const { collectionIds, queryText, topK = 10, threshold = 0.0 } = req.body;

        if (!Array.isArray(collectionIds) || collectionIds.length === 0) {
            return res.status(400).json({ error: 'collectionIds must be a non-empty array' });
        }
        if (!queryText) {
            return res.status(400).json({ error: 'queryText is required' });
        }

        const storage = await VectorStorage.create();
        const results = await storage.queryMultipleCollections(collectionIds, queryText, topK, threshold);

        res.json(results);
    } catch (error) {
        console.error('[VectorStorage] QueryMulti error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Purge all collections
 */
app.post('/api/plugins/uwu-memory/purge-all', async (req, res) => {
    try {
        const storage = await VectorStorage.create();
        await storage.purgeAll();

        res.json({ success: true });
    } catch (error) {
        console.error('[VectorStorage] PurgeAll error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Start server
 */
const HOST = process.env.HOST || 'localhost';
const server = app.listen(PORT, HOST, () => {
    console.log(`[VectorStorage] Server listening on ${HOST}:${PORT}`);
    console.log(`[VectorStorage] API available at http://${HOST}:${PORT}/api/plugins/uwu-memory/`);
});

/**
 * Graceful shutdown
 */
process.on('SIGTERM', () => {
    console.log('[VectorStorage] Shutting down...');
    server.close(() => {
        console.log('[VectorStorage] Server closed');
        process.exit(0);
    });
});

export { app };