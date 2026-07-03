import type { LoaderFunctionArgs } from "@remix-run/node";
import { login } from "~/shopify.server";



export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    throw new Response("Missing shop parameter", { status: 400 });
  }


  throw await login(request);
}

