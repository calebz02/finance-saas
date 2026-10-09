import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Every dashboard page. /sign-in and /sign-up stay public; /api is protected per router by requireAuth.
const isProtectedRoute = createRouteMatcher([
  "/",
  "/transactions(.*)",
  "/accounts(.*)",
  "/categories(.*)",
  "/settings(.*)",
]);

export default clerkMiddleware((auth, request) => {
  if (isProtectedRoute(request)) {
    auth().protect();
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
