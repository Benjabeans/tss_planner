export interface LaneInput {
  id: string;
  start: number;
  end: number;
}

export interface LanePlacement {
  lane: number;
  lanes: number;
}

/**
 * Side-by-side placement for one calendar column. Blocks that transitively overlap form
 * a cluster; each block takes the first free lane, and the whole cluster shares a lane count.
 */
export function layoutLanes(items: LaneInput[]): Map<string, LanePlacement> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const result = new Map<string, LanePlacement>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = laneEnds.length;
    for (const c of cluster) result.set(c.id, { lane: c.lane, lanes });
    cluster = [];
    laneEnds = [];
  };

  for (const it of sorted) {
    if (it.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else {
      laneEnds[lane] = it.end;
    }
    cluster.push({ id: it.id, lane });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return result;
}
