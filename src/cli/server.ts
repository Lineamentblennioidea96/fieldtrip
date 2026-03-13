import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import MiniSearch from 'minisearch';
import { SchemaProperty, SchemaType } from '../parsers/types';

interface Stats {
  totalProperties: number;
  totalFiles: number;
  schemaTypes: Record<string, number>;
}

export function createServer(
  miniSearch: MiniSearch<SchemaProperty>,
  properties: SchemaProperty[],
  port: number,
  scanDir: string
): Promise<void> {
  const app = express();

  // Compute stats
  const fileSet = new Set(properties.map((p) => p.filePath));
  const schemaTypes: Record<string, number> = {};
  for (const p of properties) {
    schemaTypes[p.schemaType] = (schemaTypes[p.schemaType] || 0) + 1;
  }
  const stats: Stats = {
    totalProperties: properties.length,
    totalFiles: fileSet.size,
    schemaTypes,
  };

  // Serve built UI — find dist/ui which contains the Vite-built assets
  // Priority: dist/ui from project root (works for both tsx dev and compiled)
  const candidates = [
    path.resolve(__dirname, '..', '..', 'ui'),       // from dist/cli/cli/ → dist/ui
    path.resolve(__dirname, '..', '..', 'dist', 'ui'), // from src/cli/ → dist/ui (tsx dev)
    path.join(__dirname, '..', 'ui'),                  // fallback
  ];
  let uiPath = candidates[0];
  for (const candidate of candidates) {
    const indexPath = path.join(candidate, 'assets');
    if (fs.existsSync(indexPath)) {
      uiPath = candidate;
      break;
    }
  }
  app.use(express.static(uiPath));

  // Search API — supports "exact match" with quotes
  app.get('/api/search', (req, res) => {
    const rawQuery = (req.query.q as string || '').trim();
    const schemaType = req.query.schemaType as string | undefined;

    if (!rawQuery) {
      res.json({ results: [], total: 0 });
      return;
    }

    // Check for quoted exact-match phrases
    const exactMatch = /^"(.+)"$/.exec(rawQuery);

    const typeFilter = schemaType
      ? (result: any) => result.schemaType === schemaType
      : undefined;

    if (exactMatch) {
      // Exact match: search without fuzzy/prefix, then post-filter to only
      // keep results where a stored field exactly contains the quoted term
      const term = exactMatch[1];
      const searchOpts: any = {
        prefix: false,
        fuzzy: false,
        boost: { name: 3, description: 1 },
        ...(typeFilter ? { filter: typeFilter } : {}),
      };
      const candidates = miniSearch.search(term, searchOpts);
      const termLower = term.toLowerCase();
      const results = candidates.filter((r: any) =>
        r.name?.toLowerCase() === termLower ||
        r.type?.toLowerCase() === termLower ||
        r.description?.toLowerCase().includes(termLower)
      );
      res.json({ results, total: results.length });
    } else {
      const searchOpts: any = {
        prefix: true,
        fuzzy: 0.2,
        boost: { name: 3, description: 1 },
        ...(typeFilter ? { filter: typeFilter } : {}),
      };
      const results = miniSearch.search(rawQuery, searchOpts);
      res.json({ results, total: results.length });
    }
  });

  // All properties endpoint (for browsing)
  app.get('/api/properties', (req, res) => {
    const schemaType = req.query.schemaType as string | undefined;
    let filtered = properties;
    if (schemaType) {
      filtered = properties.filter((p) => p.schemaType === schemaType);
    }
    res.json({ properties: filtered, total: filtered.length });
  });

  // File content endpoint — returns raw schema file
  app.get('/api/file', (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }

    const absolutePath = path.resolve(scanDir, filePath);
    // Prevent directory traversal
    if (!absolutePath.startsWith(path.resolve(scanDir))) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    try {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      res.json({ content, filePath });
    } catch {
      res.status(404).json({ error: 'file not found' });
    }
  });

  // Schemas list endpoint — grouped by file
  const schemasMap = new Map<string, { filePath: string; schemaType: string; count: number }>();
  for (const p of properties) {
    const existing = schemasMap.get(p.filePath);
    if (existing) {
      existing.count++;
    } else {
      schemasMap.set(p.filePath, { filePath: p.filePath, schemaType: p.schemaType, count: 0 });
      schemasMap.get(p.filePath)!.count = 1;
    }
  }
  const schemasList = Array.from(schemasMap.values());

  app.get('/api/schemas', (_req, res) => {
    res.json({ schemas: schemasList });
  });

  // Stats API
  app.get('/api/stats', (_req, res) => {
    res.json(stats);
  });

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(uiPath, 'index.html'));
  });

  return new Promise((resolve) => {
    app.listen(port, () => {
      resolve();
    });
  });
}
