import type { EmbeddingModel, RemoteEmbedder } from "./ports.js";
import { batches } from "../domain/provider.js";

/**
 * An embedding model that has no local endpoint: a remote provider serves it
 * alone, and the provider's client is both the model's embedder and its remote
 * counterpart, so a collection recorded at the provider and one recorded as
 * local (built by a local twin of the model) are indexed and searched the same
 * way.
 *
 * What the model reports is configured, never asked of the provider: `identity`
 * is the `model@revision` a collection built by the local twin recorded (that
 * collection is searchable by a model reporting the same identity), and
 * `dimension` is the length of its vectors. So describing it, and health, spend
 * nothing at the provider.
 */
export const makeHostedModel = (options: { readonly name: string; readonly remote: RemoteEmbedder; readonly identity: string; readonly dimension: number }): EmbeddingModel => {
  const { name, remote, identity, dimension } = options;
  return {
    name,
    remoteOnly: remote.provider,
    embedder: {
      info: async () => ({ model: identity, dimension }),
      // The provider's batch limit is the port's to respect.
      embed: async (texts) => {
        const vectors: (readonly number[])[] = [];
        for (const batch of batches(texts, remote.batch)) vectors.push(...(await remote.embed(batch)).vectors);
        return vectors;
      },
    },
    remote: { [remote.provider]: remote },
  };
};
