import { tarjan, NeighborListGraph } from './graph/tarjan';
import { Graph } from './../store/store';
import { BundleNode, BundleTree } from './bundle-tree';
import { neighborsList } from './graph/neighbors-list';

const trimGraph = (graph: Graph) => {
  let minEdge = Infinity;
  Object.keys(graph).forEach(k => {
    Object.keys(graph[k]).forEach(n => {
      if (graph[k][n] < minEdge && graph[k][n] > 0) {
        minEdge = graph[k][n];
      }
    });
  });

  Object.keys(graph).forEach(k => {
    Object.keys(graph[k]).forEach(n => {
      graph[k][n] = Math.max(graph[k][n] - minEdge, 0);
    });
  });
};

// Turn into a Markov chain
const normalize = (graph: Graph) => {
  Object.keys(graph).forEach(k => {
    const ns = Object.keys(graph[k]);
    const total = ns.reduce((a, c) => a + graph[k][c], 0);
    ns.forEach(n => (graph[k][n] = graph[k][n] / total));
  });
};

type Cluster = string[];
type Clusters = Cluster[];

const normalizeEntryPoints = (
  cluster: Cluster,
  tree: BundleTree,
  pathCluster: { [key: string]: Cluster },
  entryPointModule: { [key: string]: Module }
) => {
  let changed = false;
  for (const a of cluster) {
    for (const b of cluster) {
      if (a === b) {
        continue;
      }
      const ancestor = tree.lca(entryPointModule[a], entryPointModule[b]);
      if (!ancestor) {
        throw new Error('Cannot find LCA');
      }
      const entry = ancestor[0].module;
      if (cluster.indexOf(entry) < 0) {
        while ((pathCluster[entry] || []).length) {
          cluster.push(pathCluster[entry].pop());
          changed = true;
        }
      }
    }
  }
  if (changed) {
    normalizeEntryPoints(cluster, tree, pathCluster, entryPointModule);
  }
};

export interface Module {
  module: string;
  parentModule: string;
}

export const clusterize = (bundleGraph: Graph, modules: Module[], n: number): Cluster | Clusters => {
  if (n <= 0) {
    throw new Error('The number of bundles should be a positive number');
  }

  const nodes = new Set<string>();
  Object.keys(bundleGraph).forEach(k => {
    nodes.add(k);
    Object.keys(bundleGraph[k]).forEach(n => {
      nodes.add(n);
    });
  });

  if (n > nodes.size) {
    throw new Error('The number of bundles should be less than the number of routes');
  }

  const result: string[] = [];
  if (n === nodes.size) {
    for (const r of nodes.values()) {
      result.push(r);
    }
    return result;
  }

  // Build a Markov chain
  normalize(bundleGraph);

  // Each node in the bundle tree is an entry point of a bundle.
  // The node contains all the routes defined in this entry point.
  const bundleTree = new BundleTree();
  bundleTree.build(modules);

  // Path to module mapping
  const entryPointModule: { [key: string]: Module } = {};
  modules.forEach(m => {
    entryPointModule[m.module] = m;
  });

  while (true) {
    // Build the neighbors list in the current version of the graph.
    const nl = neighborsList(bundleGraph, nodes);

    // Find the connected components.
    const cc = tarjan(nl);

    // Each node in each connected component should point to
    // the connected component itself.
    // Two nodes from the same connected component should point to the same reference.
    const bundleClusterMap: { [key: string]: Cluster } = {};
    cc.forEach(c => {
      for (const n of c) {
        bundleClusterMap[n] = c;
      }
    });

    // For each connected component, we want to push all the parents of all the routes.
    // For example, if the user wants to load `/a/b/c` from `/d`, this means
    // that if `/a/b/c` & `/d` are in the same connected component, we should also
    // push `/a` and `/a/b` because without them we cannot provide `/a/b/c`.
    cc.forEach(c => {
      normalizeEntryPoints(c, bundleTree, bundleClusterMap, entryPointModule);
    });

    // Drop all the empty connected components.
    const res = cc.filter(c => c.length);
    if (res.length >= n) {
      return res;
    }

    // Trim the graph if we haven't found a solution yet.
    trimGraph(bundleGraph);
  }
};
