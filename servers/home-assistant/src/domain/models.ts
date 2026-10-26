/** Home Assistant as this server holds it, mapped from the wire (infra/mapping.ts). */

export type Attributes = Readonly<Record<string, unknown>>;

/** The user the token belongs to, as this server knows it. */
export type TokenUser = {
  readonly name: string | undefined;
  readonly isAdmin: boolean;
  /** Actions Home Assistant refused this token as admin-only, beyond those known to be (domain/admin.ts). */
  readonly refusedActions: readonly string[];
};

export type EntityState = {
  readonly entityId: string;
  readonly state: string;
  readonly attributes: Attributes;
  readonly lastChanged: string;
  readonly lastUpdated: string;
};

export type InstanceConfig = {
  readonly version: string;
  readonly state: string;
  readonly timeZone: string;
  readonly locationName: string | undefined;
  /** Started with its configuration broken, or by request, without most integrations. */
  readonly recoveryMode: boolean;
  readonly safeMode: boolean;
};

export type Field = {
  /** The key the action's data takes. */
  readonly key: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly required: boolean;
  readonly example: unknown;
  /** The selector's kind (number, boolean, select, entity, ...), which says what the value is. */
  readonly selector: string | undefined;
  /** A select's options, as values. */
  readonly options: readonly string[] | undefined;
};

export type Action = {
  readonly domain: string;
  readonly service: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly fields: readonly Field[];
  /** It takes a target: entities, devices, areas, floors or labels. */
  readonly targets: boolean;
  /** Whether it answers with data: never, if asked (return_response), or always. */
  readonly response: "none" | "optional" | "only";
};

export type Area = { readonly id: string; readonly name: string; readonly floorId: string | undefined };
export type Floor = { readonly id: string; readonly name: string };
export type Device = { readonly id: string; readonly name: string | undefined; readonly areaId: string | undefined; readonly disabled: boolean };
export type EntityEntry = {
  readonly entityId: string;
  readonly name: string | undefined;
  readonly deviceId: string | undefined;
  readonly areaId: string | undefined;
  readonly disabled: boolean;
};

/** The area, device and entity registries, as the WebSocket API lists them. */
export type Registries = {
  readonly areas: readonly Area[];
  readonly floors: readonly Floor[];
  readonly devices: readonly Device[];
  readonly entities: readonly EntityEntry[];
};

export type StateChange = { readonly state: string; readonly at: string; readonly attributes?: Attributes | undefined };

export type EntityHistory = { readonly entityId: string; readonly changes: readonly StateChange[] };

export type LogbookEntry = {
  readonly when: string;
  readonly entityId: string | undefined;
  readonly name: string | undefined;
  readonly state: string | undefined;
  readonly message: string | undefined;
  /** What caused it, as far as Home Assistant knows. */
  readonly cause: {
    readonly userId: string | undefined;
    readonly action: string | undefined;
    readonly entityId: string | undefined;
    readonly name: string | undefined;
    readonly event: string | undefined;
  };
};

/** What an action is aimed at, as Home Assistant's target selector takes it. */
export type Target = {
  readonly entityId: readonly string[];
  readonly deviceId: readonly string[];
  readonly areaId: readonly string[];
  readonly floorId: readonly string[];
  readonly labelId: readonly string[];
};

export type ActionCall = {
  readonly domain: string;
  readonly service: string;
  readonly target: Target;
  readonly data: Readonly<Record<string, unknown>>;
  readonly returnResponse: boolean;
};

export type ActionOutcome = {
  /** The states that changed while the action ran. */
  readonly changed: readonly EntityState[];
  /** Only when the call asked for it. */
  readonly response?: unknown;
};
