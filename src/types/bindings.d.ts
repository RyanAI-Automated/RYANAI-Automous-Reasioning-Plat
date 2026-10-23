// File path: ./src/types/bindings.d.ts

declare module 'bindings' {
  interface BindingsOptions {
    module_root?: string;
    bindings?: string;
  }

  /**
   * Loads a compiled native C++ addon module.
   * @param nameOrOptions - Module name string or configuration options object.
   */
  function bindings(nameOrOptions: string | BindingsOptions): unknown;

  namespace bindings {}

  export = bindings;
}