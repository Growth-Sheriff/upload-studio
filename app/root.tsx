import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse
} from "@remix-run/react";
import * as Sentry from "@sentry/remix";
import { withSentry, captureRemixErrorBoundaryError } from "@sentry/remix";

function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (error instanceof Error) {
    Sentry.captureException(error);
  } else {
    Sentry.captureException(new Error(`Unknown Remix Route Error: ${JSON.stringify(error)}`));
  }

  captureRemixErrorBoundaryError(error);

  return (
    <html>
      <head>
        <title>Application Error</title>
        <Meta />
        <Links />
      </head>
      <body>
        <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif" }}>
          <h1>Application Error</h1>
          <p>An unexpected error occurred. The support team has been notified.</p>
          {isRouteErrorResponse(error) ? (
            <p>{error.status} {error.statusText}</p>
          ) : (
            <p>{error instanceof Error ? error.message : "Unknown Error"}</p>
          )}
        </div>
        <Scripts />
      </body>
    </html>
  );
}

export default withSentry(App);