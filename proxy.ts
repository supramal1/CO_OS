import NextAuth from "next-auth";
import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from "next/server";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);
const authProxy = auth as NextMiddleware;

export function proxy(req: NextRequest, event: NextFetchEvent) {
  if (
    req.nextUrl.pathname === "/agents" ||
    req.nextUrl.pathname.startsWith("/agents/")
  ) {
    return NextResponse.redirect(new URL("/forge/kanban", req.url), 308);
  }
  return authProxy(req, event);
}

export const config = {
  matcher: [
    "/cookbook/:path*",
    "/forge/:path*",
    "/profile/:path*",
    "/speak-to-charlie/:path*",
    "/agents/:path*",
    "/workforce/:path*",
    "/admin/:path*",
  ],
};
