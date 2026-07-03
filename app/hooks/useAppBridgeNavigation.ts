import { useEffect } from 'react';
import { useLocation } from '@remix-run/react';










export function useAppBridgeNavigation(): void {
  const location = useLocation();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window as any;


    const syncHistory = () => {
      if (win.shopify?.navigate?.history) {
        try {
          win.shopify.navigate.history.replace(location.pathname + location.search);
        } catch (e) {

        }
      }
    };


    syncHistory();
    const timer = setTimeout(syncHistory, 500);


    const handlePopState = (event: PopStateEvent) => {
       if (win.shopify?.navigate?.history) {
         try {
            win.shopify.navigate.history.replace(location.pathname + location.search);
         } catch (e) {
            console.debug('[AppBridge] PopState error', e);
         }
       }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [location.pathname, location.search]);
}




interface ShopifyGlobal {
  navigate?: {
    history?: {
      push: (path: string) => void;
      replace: (path: string) => void;
    };
  };
  environment?: {
    embedded: boolean;
    mobile: boolean;
  };
}

export default useAppBridgeNavigation;

