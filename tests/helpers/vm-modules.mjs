import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function loadSourceModule(source, {
  context,
  identifier = 'file:///source.mjs',
  modules = {}
}) {
  const cache = new Map();

  function createModule(specifier, referrer) {
    if (cache.has(specifier)) return cache.get(specifier);
    const descriptor = modules[specifier];
    if (!descriptor) throw new Error(`No VM module provided for ${specifier} imported by ${referrer.identifier}`);
    if (descriptor.error) throw descriptor.error;

    let module;
    if (descriptor.exports) {
      const exports = descriptor.exports;
      module = new vm.SyntheticModule(Object.keys(exports), function setExports() {
        Object.entries(exports).forEach(([name, value]) => this.setExport(name, value));
      }, { context, identifier: `stub:${specifier}` });
    } else {
      module = createSourceTextModule(descriptor.source, descriptor.identifier ?? `file:///${specifier}`, context);
    }
    cache.set(specifier, module);
    return module;
  }

  const linker = (specifier, referrer) => createModule(specifier, referrer);
  const importModuleDynamically = async (specifier, referrer) => {
    const module = createModule(specifier, referrer);
    if (module.status === 'unlinked') await module.link(linker);
    if (module.status === 'linked') await module.evaluate();
    return module;
  };
  const module = createSourceTextModule(source, identifier, context, importModuleDynamically);
  await module.link(linker);
  await module.evaluate();
  return module.namespace;
}

export async function loadModuleFile(filePath, options) {
  const source = await readFile(filePath, 'utf8');
  return loadSourceModule(source, {
    ...options,
    identifier: pathToFileURL(filePath).href
  });
}

function createSourceTextModule(source, identifier, context, importModuleDynamically) {
  return new vm.SourceTextModule(source, {
    context,
    identifier,
    importModuleDynamically
  });
}
