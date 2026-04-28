import middleware from "next-auth/middleware";

export const proxy = middleware;

export const config = {
  matcher: [
    "/cookbook/:path*",
    "/forge/:path*",
    "/speak-to-charlie/:path*",
    "/agents/:path*",
    "/workforce/:path*",
    "/admin/:path*",
  ],
};
