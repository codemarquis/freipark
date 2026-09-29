import { posthog } from './posthog';

type LogAttributes = Record<string, string | number | boolean>;

export const posthogLogger = {
  info: (message: string, attributes?: LogAttributes) => {
    posthog?.logger.info(message, attributes);
  },
  error: (message: string, attributes?: LogAttributes) => {
    posthog?.logger.error(message, attributes);
  },
};
