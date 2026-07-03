import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import shopify from "~/shopify.server";



export async function loader({ request }: LoaderFunctionArgs) {




  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {

    return redirect(`/app?shop=${shop}`);
  }

  return redirect("/app");
}
