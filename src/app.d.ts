declare global {
  namespace App {
    interface Platform {
      env: Cloudflare.Env;
      cf?: IncomingRequestCfProperties;
    }
  }
}

export {};
