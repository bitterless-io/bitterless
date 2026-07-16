import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import ArcoModule from '@arco-design/web-vue';
import { JSDOM } from 'jsdom';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(projectRoot, '.eyes-project-filter-render-'));
const ArcoVue = ArcoModule.default ?? ArcoModule;

const vuePlugin = {
  name: 'eyes-on-agents-vue-sfc',
  setup(buildApi) {
    buildApi.onLoad({ filter: /\.vue$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { descriptor, errors } = parse(source, { filename: args.path });
      assert.deepEqual(errors, []);
      const compiled = compileScript(descriptor, {
        id: 'eyes-on-agents-project-filter',
        inlineTemplate: true,
      });
      return {
        contents: compiled.content,
        loader: 'ts',
        resolveDir: dirname(args.path),
      };
    });
  },
};

const stubPlugin = {
  name: 'eyes-on-agents-project-filter-stubs',
  setup(buildApi) {
    buildApi.onResolve(
      { filter: /@renderer\/common\/i18n\/i18n\.helper$/ },
      () => ({ path: 'i18n', namespace: 'eyes-project-filter-test' }),
    );
    buildApi.onResolve(
      { filter: /eyesOnAgents\.store$/ },
      () => ({ path: 'store', namespace: 'eyes-project-filter-test' }),
    );
    buildApi.onLoad({ filter: /.*/, namespace: 'eyes-project-filter-test' }, (args) => {
      if (args.path === 'i18n') {
        return {
          contents: `
            export const i18nHelper = {
              eyesOnAgents: {
                board: {
                  projectFilterLabel: 'Filter Uncategorized by Project',
                  allProjects: 'All',
                  noProject: 'No project'
                }
              }
            };
          `,
          loader: 'js',
        };
      }
      return {
        contents: `
          export const eyesOnAgentsStore = {
            uncategorizedProjectFilterValue: 'all',
            uncategorizedProjectOptions: [{
              value: 'all',
              type: 'all',
              count: 2,
              projectKey: null,
              projectRoot: null,
              projectName: null,
              shortRoot: null,
              duplicateName: false
            }],
            selectUncategorizedProjectFilter() {}
          };
        `,
        loader: 'js',
      };
    });
  },
};

try {
  const outfile = join(buildRoot, 'ProjectFilter.mjs');
  await build({
    entryPoints: [join(
      projectRoot,
      'src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.vue',
    )],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.web.json'),
    external: ['vue'],
    plugins: [stubPlugin, vuePlugin],
  });

  const { default: ProjectFilter } = await import(
    `${pathToFileURL(outfile).href}?v=${Date.now()}`
  );
  const app = createSSRApp({ render: () => h(ProjectFilter) });
  app.use(ArcoVue);
  const html = await renderToString(app);
  const document = new JSDOM(html).window.document;
  const label = document.querySelector('label.project-filter');
  const select = document.querySelector('.project-filter__select.arco-select-view');
  const input = select?.querySelector('input');

  assert.ok(label, 'Project filter must render as a real label');
  assert.ok(select, 'the style selector must match the actual Arco Select root');
  assert.ok(input, 'the searchable Arco Select must expose a focusable input');
  assert.equal(input.labels?.[0], label, 'the focusable input must be associated with the label');
  assert.match(label.textContent ?? '', /Filter Uncategorized by Project/);
  console.log('EyesOnAgents Project filter rendered-DOM test passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
