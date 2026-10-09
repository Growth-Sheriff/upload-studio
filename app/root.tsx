import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse,
  useLoaderData
} from "@remix-run/react";

export function loader(_args: LoaderFunctionArgs) { return json({ apiKey: process.env.SHOPIFY_API_KEY || '' }); }
function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="shopify-api-key" content={apiKey} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
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
          <p>The request could not be completed. Please retry or contact info@actualscope.com.</p>
          {isRouteErrorResponse(error) ? (
            <p>{error.status} {error.statusText}</p>
          ) : (
            <p>Please try again.</p>
          )}
        </div>
        <Scripts />
      </body>
    </html>
  );
}

export default App;
