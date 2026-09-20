/**
 * Turns an in-memory project into the artefacts the user can download:
 *   - ZIP with a full Rojo project (source of truth)
 *   - .rbxmx model for Roblox Studio ("Import from file")
 *   - .plugin.luau with the game baked in (one-click build in Studio)
 *   - plain files (used by the CLI writing straight to disk)
 */
import { createZip } from './zip.js';
import { buildProjectReadme, buildRojoProject, buildRbxmx } from './rbxmx.js';
import { buildPlugin } from './plugin.js';
import { normalisePath } from './validate.js';
import { slugify } from './util.js';

const GITIGNORE = `# Artefakty buildu – trzymamy tylko źródła
*.rbxl
*.rbxlx
build/
dist/
exports/
node_modules/
`;

export function projectSlug(project) {
  return slugify(project?.name || 'ai-game', 'ai-game');
}

/** Complete file list of the downloadable project. */
export function assembleFiles(project) {
  const files = [];

  for (const file of project.files || []) {
    files.push({ path: normalisePath(file.path), content: file.content });
  }

  files.push({ path: 'README.md', content: buildProjectReadme(project) });
  files.push({ path: 'default.project.json', content: JSON.stringify(buildRojoProject(project), null, 2) + '\n' });
  files.push({ path: '.gitignore', content: GITIGNORE });

  if (project.design?.designDoc) {
    files.push({ path: 'docs/DESIGN.md', content: `# ${project.name || 'AI Game'}\n\n${project.design.designDoc}\n` });
  }
  if (project.plan?.architecture) {
    files.push({ path: 'docs/ARCHITECTURE.md', content: `# Architektura\n\n${project.plan.architecture}\n` });
  }
  if (project.world) {
    files.push({ path: 'docs/world.json', content: JSON.stringify(project.world, null, 2) + '\n' });
  }
  files.push({
    path: 'ai-builder.json',
    content: JSON.stringify({
      generator: 'Roblox AI Game Builder',
      version: 1,
      createdAt: project.meta?.createdAt || new Date().toISOString(),
      name: project.name,
      tagline: project.tagline,
      genre: project.genre,
      summary: project.summary,
      design: project.design,
      plan: project.plan,
      world: project.world,
      notes: project.notes || [],
      files: project.files || [],
    }, null, 2) + '\n',
  });

  return files;
}

export function buildZipBuffer(project) {
  return createZip(assembleFiles(project));
}

export function buildRbxmxSource(project) {
  return buildRbxmx(project);
}

export function buildPluginSource(project) {
  return buildPlugin(project);
}

/**
 * @param {object} project
 * @param {'zip'|'rbxmx'|'plugin'|'rojo'} format
 * @returns {{filename: string, contentType: string, body: Buffer}}
 */
export function exportAs(project, format = 'zip') {
  const slug = projectSlug(project);
  switch (format) {
    // Całe miejsce: struktura identyczna jak .rbxmx (usługi w korzeniu),
    // więc Studio otwiera to jako plik miejsca - tak wygląda build Rojo.
    case 'place':
    case 'rbxlx': {
      const { xml, warnings } = buildRbxmx(project);
      return {
        filename: `${slug}.rbxlx`,
        contentType: 'application/xml; charset=utf-8',
        body: Buffer.from(xml, 'utf8'),
        warnings,
      };
    }
    case 'rbxmx': {
      const { xml, warnings } = buildRbxmx(project);
      return {
        filename: `${slug}.rbxmx`,
        contentType: 'application/xml; charset=utf-8',
        body: Buffer.from(xml, 'utf8'),
        warnings,
      };
    }
    case 'plugin':
      return {
        filename: `${slug}.plugin.luau`,
        contentType: 'text/plain; charset=utf-8',
        body: Buffer.from(buildPlugin(project), 'utf8'),
      };
    case 'rojo':
    case 'zip':
    default:
      return {
        filename: `${slug}-rojo.zip`,
        contentType: 'application/zip',
        body: buildZipBuffer(project),
      };
  }
}
