import NextAuth from "next-auth";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);

export const proxy = auth;

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
