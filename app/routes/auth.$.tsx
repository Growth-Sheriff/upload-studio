import type { LoaderFunctionArgs } from "@remix-run/node";
import shopify from "~/shopify.server";




export async function loader({ request }: LoaderFunctionArgs) {

  await shopify.authenticate.admin(request);


  return new Response(null, {
    status: 302,
    headers: { Location: "/app" },
  });
}
