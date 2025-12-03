import type { MeterConnection } from './types';

/**
 * Calculate hierarchy depth for a meter (used for bottom-up processing)
 */
export function getHierarchyDepth(
  meterId: string,
  connectionsMap: Map<string, string[]>,
  visited = new Set<string>()
): number {
  if (visited.has(meterId)) return 0; // Prevent cycles
  visited.add(meterId);
  
  const children = connectionsMap.get(meterId) || [];
  if (children.length === 0) return 0;
  
  return 1 + Math.max(...children.map(c => getHierarchyDepth(c, connectionsMap, new Set(visited))));
}

/**
 * Sort parent meters by hierarchy depth (shallowest first for bottom-up processing)
 * This ensures: Leaf meters → Check meters → Bulk Check → Council (shallowest last)
 */
export function sortParentMetersByDepth<T extends { id: string; meter_number: string }>(
  parentMeters: T[],
  connectionsMap: Map<string, string[]>
): T[] {
  const withDepth = parentMeters.map(m => ({
    meter: m,
    depth: getHierarchyDepth(m.id, connectionsMap)
  }));
  
  // Sort by depth ascending (closest to leaves first)
  return withDepth
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return b.meter.meter_number.localeCompare(a.meter.meter_number);
    })
    .map(item => item.meter);
}

/**
 * Derive parent-child connections from indent levels and meter order
 */
export function deriveConnectionsFromIndents<T extends { id: string }>(
  meters: T[],
  indentLevels: Map<string, number>
): MeterConnection[] {
  const connections: MeterConnection[] = [];
  
  meters.forEach((meter, index) => {
    const indentLevel = indentLevels.get(meter.id) || 0;
    
    if (indentLevel > 0) {
      // Find parent: closest preceding meter with indent level - 1
      for (let i = index - 1; i >= 0; i--) {
        const prevMeter = meters[i];
        const prevIndent = indentLevels.get(prevMeter.id) || 0;
        if (prevIndent === indentLevel - 1) {
          connections.push({ parent_meter_id: prevMeter.id, child_meter_id: meter.id });
          break;
        }
      }
    }
  });
  
  return connections;
}

/**
 * Check if a meter is visible based on hierarchy expansion state
 */
export function isMeterVisible(
  meterId: string,
  connectionsMap: Map<string, string[]>,
  expandedMeters: Set<string>
): boolean {
  // Find parent of this meter
  const parentId = Array.from(connectionsMap.entries())
    .find(([_, children]) => children.includes(meterId))?.[0];
  
  // If no parent, always visible
  if (!parentId) return true;
  
  // If has parent, check if parent is expanded
  if (!expandedMeters.has(parentId)) return false;
  
  // Recursively check if all ancestors are visible
  return isMeterVisible(parentId, connectionsMap, expandedMeters);
}

/**
 * Build a connections map (parent_id -> child_ids[]) from connection array
 */
export function buildConnectionsMap(connections: MeterConnection[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  
  connections.forEach(conn => {
    if (!map.has(conn.parent_meter_id)) {
      map.set(conn.parent_meter_id, []);
    }
    map.get(conn.parent_meter_id)!.push(conn.child_meter_id);
  });
  
  return map;
}

/**
 * Build parent info map (child_id -> parent_meter_number) for display
 */
export function buildParentInfoMap<T extends { id: string; meter_number: string }>(
  connections: MeterConnection[],
  meters: T[]
): Map<string, string> {
  const meterMap = new Map(meters.map(m => [m.id, m.meter_number]));
  const parentInfo = new Map<string, string>();
  
  connections.forEach(conn => {
    const parentMeterNumber = meterMap.get(conn.parent_meter_id);
    if (parentMeterNumber) {
      parentInfo.set(conn.child_meter_id, parentMeterNumber);
    }
  });
  
  return parentInfo;
}

/**
 * Calculate indent level for a meter based on its hierarchy depth
 */
export function calculateIndentLevel(
  meterId: string,
  connections: MeterConnection[],
  visited = new Set<string>()
): number {
  if (visited.has(meterId)) return 0; // Prevent cycles
  visited.add(meterId);
  
  // Find parent of this meter
  const parentConnection = connections.find(c => c.child_meter_id === meterId);
  if (!parentConnection) return 0; // Root level
  
  return 1 + calculateIndentLevel(parentConnection.parent_meter_id, connections, visited);
}

/**
 * Get all descendant meter IDs for a parent meter
 */
export function getAllDescendants(
  meterId: string,
  connectionsMap: Map<string, string[]>,
  visited = new Set<string>()
): string[] {
  if (visited.has(meterId)) return [];
  visited.add(meterId);
  
  const children = connectionsMap.get(meterId) || [];
  const descendants: string[] = [...children];
  
  children.forEach(childId => {
    descendants.push(...getAllDescendants(childId, connectionsMap, new Set(visited)));
  });
  
  return descendants;
}

/**
 * Get leaf meter IDs (meters with no children)
 */
export function getLeafMeterIds(
  meterIds: string[],
  connectionsMap: Map<string, string[]>
): string[] {
  return meterIds.filter(id => {
    const children = connectionsMap.get(id) || [];
    return children.length === 0;
  });
}

/**
 * Get parent meter IDs (meters with children)
 */
export function getParentMeterIds(connectionsMap: Map<string, string[]>): string[] {
  return Array.from(connectionsMap.keys()).filter(id => {
    const children = connectionsMap.get(id) || [];
    return children.length > 0;
  });
}
