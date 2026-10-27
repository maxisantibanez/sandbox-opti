import type {
  Consumption,
  ProductMixScene,
  ProductNode,
  ProductState,
  ResourceNode,
  ResourceState,
} from "./product-mix-scene";

// Visual scale for the Production Floor. Mathematical values never become
// world units directly: positions depend only on how many entities exist,
// and every magnitude is first normalized and then mapped into fixed limits.
//
// - Each resource vessel has the same height: its own capacity is its 100 %.
//   Resources are measured in different units, so capacities are never
//   compared across resources.
// - Channel width compares coefficients only within one resource.
// - Product columns compare quantities among the represented products.
//
// See docs/SCENARIO_3D.md, "Normalización visual".

export const FLOOR = {
  /** Height of a product column at the largest represented quantity. */
  productMaxHeight: 1.6,
  /** A positive quantity never collapses into the zero case. */
  productMinHeight: 0.05,
  /** Height of every resource vessel: the whole capacity of that resource. */
  vesselHeight: 1.5,
  /** Channel width for the smallest and the largest coefficient of a resource. */
  channelMinWidth: 0.05,
  channelMaxWidth: 0.2,
  resourceSpacing: 1.9,
  productSpacing: 2.4,
  resourceZ: -1.4,
  productZ: 1.6,
  /** Free border around the outermost objects. */
  margin: 1.1,
} as const;

/** One stacked part of a vessel, from the floor of the vessel upwards. */
export interface VesselSegment {
  /** Represented product, or null for use by variables without semantics. */
  variableId: string | null;
  bottom: number;
  top: number;
}

export interface PlacedResource {
  resource: ResourceNode;
  state: ResourceState | null;
  x: number;
  z: number;
  /** Total fill from the backend activity; 0 without a measurable utilization. */
  fillHeight: number;
  /**
   * Fill explained by product, drawn only when it is non-negative and adds up
   * to the backend activity. Otherwise empty and `fillHeight` stands alone.
   */
  segments: VesselSegment[];
}

export interface PlacedProduct {
  product: ProductNode;
  state: ProductState | null;
  x: number;
  z: number;
  /** Column height for the current quantity; 0 before solving. */
  height: number;
}

export interface PlacedChannel {
  consumption: Consumption;
  from: [number, number];
  to: [number, number];
  /** Width on the floor, normalized within the resource. */
  width: number;
}

export interface FloorLayout {
  resources: PlacedResource[];
  products: PlacedProduct[];
  channels: PlacedChannel[];
  /** Platform size; it is centred on x = 0, z = centerZ. */
  platform: { width: number; depth: number; centerZ: number };
  /** Radius of a sphere around the floor and its tallest objects. */
  radius: number;
}

/** Column height for a normalized product quantity, bounded to the floor scale. */
export function productHeight(normalized: number | null): number {
  if (normalized === null || !(normalized > 0)) {
    return 0;
  }
  return Math.max(
    FLOOR.productMinHeight,
    Math.min(1, normalized) * FLOOR.productMaxHeight,
  );
}

/** Total vessel fill for a utilization ratio, clamped to the vessel. */
export function vesselFill(utilization: number | null): number {
  if (utilization === null || !(utilization > 0)) {
    return 0;
  }
  return Math.min(1, utilization) * FLOOR.vesselHeight;
}

/** Stacked use by product, or none when it cannot explain the activity. */
export function vesselSegments(
  resource: ResourceNode,
  state: ResourceState | null,
): VesselSegment[] {
  if (
    !state ||
    state.utilization === null ||
    !state.decompositionMatches ||
    state.unrepresentedAmount < 0 ||
    state.shares.some((share) => share.amount < 0)
  ) {
    return [];
  }

  const parts = [
    ...state.shares.map((share) => ({
      variableId: share.variableId as string | null,
      amount: share.amount,
    })),
    { variableId: null, amount: state.unrepresentedAmount },
  ].filter((part) => part.amount > 0);

  const segments: VesselSegment[] = [];
  let used = 0;
  for (const part of parts) {
    const bottom = Math.min(1, used / resource.capacity) * FLOOR.vesselHeight;
    used += part.amount;
    const top = Math.min(1, used / resource.capacity) * FLOOR.vesselHeight;
    if (top > bottom) {
      segments.push({ variableId: part.variableId, bottom, top });
    }
  }
  return segments;
}

/** Channel width for a coefficient relative to the largest one in its resource. */
export function channelWidth(coefficient: number, largest: number): number {
  const share =
    largest > 0 && Number.isFinite(largest)
      ? Math.min(1, Math.abs(coefficient) / largest)
      : 0;
  return (
    FLOOR.channelMinWidth +
    share * (FLOOR.channelMaxWidth - FLOOR.channelMinWidth)
  );
}

/** Evenly spaced positions centred on zero. */
export function rowPositions(count: number, spacing: number): number[] {
  return Array.from(
    { length: count },
    (_, index) => (index - (count - 1) / 2) * spacing,
  );
}

export function layoutProductMixScene(scene: ProductMixScene): FloorLayout {
  const { definition, solution } = scene;
  const productStates = new Map(
    solution.state === "optimal"
      ? solution.products.map((state) => [state.variableId, state])
      : [],
  );
  const resourceStates = new Map(
    solution.state === "optimal"
      ? solution.resources.map((state) => [state.constraintId, state])
      : [],
  );

  const resourceX = rowPositions(
    definition.resources.length,
    FLOOR.resourceSpacing,
  );
  const productX = rowPositions(
    definition.products.length,
    FLOOR.productSpacing,
  );

  const resources = definition.resources.map((resource, index) => {
    const state = resourceStates.get(resource.constraintId) ?? null;
    return {
      resource,
      state,
      x: resourceX[index],
      z: FLOOR.resourceZ,
      fillHeight: vesselFill(state?.utilization ?? null),
      segments: vesselSegments(resource, state),
    };
  });
  const products = definition.products.map((product, index) => {
    const state = productStates.get(product.variableId) ?? null;
    return {
      product,
      state,
      x: productX[index],
      z: FLOOR.productZ,
      height: productHeight(state?.normalized ?? null),
    };
  });

  const resourceById = new Map(
    resources.map((placed) => [placed.resource.constraintId, placed]),
  );
  const productById = new Map(
    products.map((placed) => [placed.product.variableId, placed]),
  );
  const largestByResource = new Map<string, number>();
  for (const consumption of definition.consumptions) {
    largestByResource.set(
      consumption.constraintId,
      Math.max(
        largestByResource.get(consumption.constraintId) ?? 0,
        Math.abs(consumption.coefficient),
      ),
    );
  }
  const channels = definition.consumptions.flatMap((consumption) => {
    const resource = resourceById.get(consumption.constraintId);
    const product = productById.get(consumption.variableId);
    if (!resource || !product) {
      return [];
    }
    const channel: PlacedChannel = {
      consumption,
      from: [product.x, product.z],
      to: [resource.x, resource.z],
      width: channelWidth(
        consumption.coefficient,
        largestByResource.get(consumption.constraintId) ?? 0,
      ),
    };
    return [channel];
  });

  const halfRow = Math.max(
    0,
    ...resourceX.map(Math.abs),
    ...productX.map(Math.abs),
  );
  const width = 2 * (halfRow + FLOOR.margin);
  const depth = FLOOR.productZ - FLOOR.resourceZ + 2 * FLOOR.margin;
  const height = Math.max(FLOOR.productMaxHeight, FLOOR.vesselHeight);

  return {
    resources,
    products,
    channels,
    platform: {
      width,
      depth,
      centerZ: (FLOOR.resourceZ + FLOOR.productZ) / 2,
    },
    radius: Math.hypot(width / 2, depth / 2, height / 2),
  };
}
