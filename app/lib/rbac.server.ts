










export const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  OPERATOR: "operator",
  VIEWER: "viewer",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];


export const PERMISSIONS = {

  SHOP_VIEW: "shop:view",
  SHOP_SETTINGS: "shop:settings",
  SHOP_BILLING: "shop:billing",
  SHOP_DELETE: "shop:delete",


  PRODUCTS_VIEW: "products:view",
  PRODUCTS_CONFIGURE: "products:configure",


  ASSET_SETS_VIEW: "asset_sets:view",
  ASSET_SETS_MANAGE: "asset_sets:manage",


  UPLOADS_VIEW: "uploads:view",
  UPLOADS_APPROVE: "uploads:approve",
  UPLOADS_REJECT: "uploads:reject",
  UPLOADS_DELETE: "uploads:delete",


  QUEUE_VIEW: "queue:view",
  QUEUE_MANAGE: "queue:manage",
  QUEUE_BULK_ACTIONS: "queue:bulk_actions",


  EXPORTS_VIEW: "exports:view",
  EXPORTS_CREATE: "exports:create",
  EXPORTS_DOWNLOAD: "exports:download",


  ANALYTICS_VIEW: "analytics:view",
  ANALYTICS_EXPORT: "analytics:export",


  API_KEYS_VIEW: "api_keys:view",
  API_KEYS_MANAGE: "api_keys:manage",


  TEAM_VIEW: "team:view",
  TEAM_MANAGE: "team:manage",
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];


export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [

    ...Object.values(PERMISSIONS),
  ],
  admin: [

    PERMISSIONS.SHOP_VIEW,
    PERMISSIONS.SHOP_SETTINGS,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.PRODUCTS_CONFIGURE,
    PERMISSIONS.ASSET_SETS_VIEW,
    PERMISSIONS.ASSET_SETS_MANAGE,
    PERMISSIONS.UPLOADS_VIEW,
    PERMISSIONS.UPLOADS_APPROVE,
    PERMISSIONS.UPLOADS_REJECT,
    PERMISSIONS.UPLOADS_DELETE,
    PERMISSIONS.QUEUE_VIEW,
    PERMISSIONS.QUEUE_MANAGE,
    PERMISSIONS.QUEUE_BULK_ACTIONS,
    PERMISSIONS.EXPORTS_VIEW,
    PERMISSIONS.EXPORTS_CREATE,
    PERMISSIONS.EXPORTS_DOWNLOAD,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,
    PERMISSIONS.API_KEYS_VIEW,
    PERMISSIONS.API_KEYS_MANAGE,
    PERMISSIONS.TEAM_VIEW,
    PERMISSIONS.TEAM_MANAGE,
  ],
  operator: [

    PERMISSIONS.SHOP_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.ASSET_SETS_VIEW,
    PERMISSIONS.UPLOADS_VIEW,
    PERMISSIONS.UPLOADS_APPROVE,
    PERMISSIONS.UPLOADS_REJECT,
    PERMISSIONS.QUEUE_VIEW,
    PERMISSIONS.QUEUE_MANAGE,
    PERMISSIONS.QUEUE_BULK_ACTIONS,
    PERMISSIONS.EXPORTS_VIEW,
    PERMISSIONS.EXPORTS_CREATE,
    PERMISSIONS.EXPORTS_DOWNLOAD,
    PERMISSIONS.ANALYTICS_VIEW,
  ],
  viewer: [

    PERMISSIONS.SHOP_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.ASSET_SETS_VIEW,
    PERMISSIONS.UPLOADS_VIEW,
    PERMISSIONS.QUEUE_VIEW,
    PERMISSIONS.EXPORTS_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
  ],
};




export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions?.includes(permission) ?? false;
}




export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some(p => hasPermission(role, p));
}




export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every(p => hasPermission(role, p));
}




export function getRolePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}




export function requirePermission(
  userRole: Role | undefined,
  requiredPermission: Permission
): void {
  if (!userRole) {
    throw new Response("Unauthorized", { status: 401 });
  }

  if (!hasPermission(userRole, requiredPermission)) {
    throw new Response("Forbidden - Insufficient permissions", { status: 403 });
  }
}




export function checkPermission(
  userRole: Role | undefined,
  requiredPermission: Permission
): boolean {
  if (!userRole) return false;
  return hasPermission(userRole, requiredPermission);
}

