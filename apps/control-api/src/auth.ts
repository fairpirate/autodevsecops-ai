import type { NextFunction, Request, Response } from "express";
import { safeEqual } from "@ads/gitlab-integration";
import type { Config } from "./config";

export type Role = "admin" | "engineer" | "viewer";

export interface AuthContext {
  key: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Bearer API-key authentication. Keys come from API_KEYS (`key:role` entries)
 * and are compared in constant time. Roles gate sensitive operations:
 *  - viewer: read-only
 *  - engineer: trigger runs, create deployments
 *  - admin: approve/rollback deployments, accept risk, manage settings
 */
export function authMiddleware(config: Config) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!token) {
      res.status(401).json({ error: { code: "unauthorized", message: "Missing Bearer token" } });
      return;
    }
    const match = config.apiKeys.find((k) => safeEqual(k.key, token));
    if (!match) {
      res.status(401).json({ error: { code: "unauthorized", message: "Invalid API key" } });
      return;
    }
    req.auth = { key: match.key, role: match.role };
    next();
  };
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, engineer: 1, admin: 2 };

export function requireRole(min: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (!role || ROLE_RANK[role] < ROLE_RANK[min]) {
      res.status(403).json({
        error: { code: "forbidden", message: `Requires ${min} role or higher` },
      });
      return;
    }
    next();
  };
}
