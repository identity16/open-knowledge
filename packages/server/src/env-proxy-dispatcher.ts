import { type Dispatcher, EnvHttpProxyAgent } from 'undici';
import type { PinoLogger } from './logger.ts';

const PROXY_VARIABLES = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY'] as const;

export function envProxyDispatcher(
  log: PinoLogger,
  logPrefix: string,
  directTarget: string,
): Dispatcher | undefined {
  const mode = process.env.NODE_USE_ENV_PROXY;
  if (mode !== undefined && mode !== '1') return undefined;
  for (const variable of PROXY_VARIABLES) {
    const proxy = process.env[variable];
    if (!proxy) continue;
    const unusable = (reason: string) => {
      log.warn(
        { variable, reason },
        `[${logPrefix}] ${variable} is not a usable proxy URL; fetching ${directTarget} directly`,
      );
      return undefined;
    };
    const hasScheme = proxy.includes('://');
    if (hasScheme && !/^https?:\/\//i.test(proxy)) {
      return unusable('only http:// and https:// proxies are supported');
    }
    const proxyUrl = hasScheme ? proxy : `http://${proxy}`;
    try {
      return new EnvHttpProxyAgent({ httpProxy: proxyUrl, httpsProxy: proxyUrl });
    } catch (err) {
      return unusable(err instanceof Error ? err.message : 'unparseable');
    }
  }
  return undefined;
}
