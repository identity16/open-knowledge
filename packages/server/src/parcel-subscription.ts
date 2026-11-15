import type { AsyncSubscription, Options, SubscribeCallback } from '@parcel/watcher';

export type NativeWatcherBackend = Pick<typeof import('@parcel/watcher'), 'subscribe'>;

export async function subscribeParcel(
  parcel: NativeWatcherBackend,
  dir: string,
  onEvents: SubscribeCallback,
  options?: Options,
  _platform: NodeJS.Platform = process.platform,
): Promise<AsyncSubscription> {
  let deliver: SubscribeCallback | null = onEvents;
  const subscription = await parcel.subscribe(
    dir,
    (err, events) => deliver?.(err, events),
    options,
  );
  return {
    async unsubscribe() {
      if (deliver === null) return;
      deliver = null;

      await subscription.unsubscribe();
    },
  };
}
