import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";



export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);


  const searchParams = url.searchParams.toString();
  const targetUrl = searchParams ? `/app?${searchParams}` : "/app";

  return redirect(targetUrl);
}

export default function Index() {
  return null;
}

