export { default } from "next-auth/middleware";

export const config = {
  matcher: ["/cookbook/:path*", "/cornerstone/:path*", "/forge/:path*"],
};
