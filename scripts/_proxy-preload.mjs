import { ProxyAgent, setGlobalDispatcher } from 'undici';
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[proxy-preload] используем ${proxyUrl} для fetch`);
}
