export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/cookbook/:path*",
    "/forge/:path*",
    "/speak-to-charlie/:path*",
    "/agents/:path*",
    "/admin/:path*",
  ],
};
