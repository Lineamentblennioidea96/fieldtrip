import { Command } from 'commander';
import { scanDirectory } from '../scanner';
import { parseFile } from '../parsers';
import { createIndex } from '../indexer';
import { createServer } from './server';
import { SchemaProperty } from '../parsers/types';

const program = new Command();

program
  .name('fieldtrip')
  .description('Search across OpenAPI, AsyncAPI, Protobuf, Avro, and JSON Schema files')
  .requiredOption('--dir <path>', 'Directory to scan for schema files')
  .option('--port <number>', 'Port for the web UI', '3200')
  .option('--no-open', 'Do not auto-open browser')
  .action(async (opts) => {
    const dir = opts.dir;
    const port = parseInt(opts.port, 10);
    const shouldOpen = opts.open !== false;

    console.log(`\nScanning ${dir} for schema files...\n`);

    // 1. Scan for files
    const files = await scanDirectory(dir);
    console.log(`Found ${files.length} potential schema files`);

    if (files.length === 0) {
      console.log('No schema files found. Check the --dir path and try again.');
      process.exit(1);
    }

    // 2. Parse all files
    const allProperties: SchemaProperty[] = [];
    let parsedCount = 0;

    for (const file of files) {
      try {
        const properties = await parseFile(file.absolutePath, file.relativePath);
        allProperties.push(...properties);
        if (properties.length > 0) parsedCount++;
      } catch (err: any) {
        console.warn(`Warning: Failed to process ${file.relativePath}: ${err.message}`);
      }
    }

    console.log(`Parsed ${parsedCount} schema files, extracted ${allProperties.length} properties\n`);

    if (allProperties.length === 0) {
      console.log('No schema properties were extracted. The files may not contain recognizable schemas.');
      process.exit(1);
    }

    // 3. Build search index
    const index = createIndex(allProperties);
    console.log('Search index built successfully');

    // 4. Start server
    await createServer(index, allProperties, port, dir);
    console.log(`\nFieldTrip is running at http://localhost:${port}\n`);

    // 5. Open browser
    if (shouldOpen) {
      try {
        const open = (await import('open')).default;
        await open(`http://localhost:${port}`);
      } catch {
        // Silently fail if browser can't be opened
      }
    }
  });

program.parse();
