import { defineProvider } from '../provider.js'

/** Exercise adapters through the same public wrapper used by the Host. */
export async function readProvider(adapter, ctx, route) {
  return defineProvider(adapter).read(ctx, route)
}
