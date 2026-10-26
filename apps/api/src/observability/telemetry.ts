import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { AppConfig } from '../config/config.js';

/**
 * Starts the OpenTelemetry SDK for traces only (metrics and logs readers are disabled explicitly, so nothing
 * is exported to a default endpoint by surprise). Returns a shutdown function that flushes pending spans.
 *
 * Add auto-instrumentations (http, express, pg) here if you want them. Review what they record first: some
 * capture URLs, headers or SQL statements.
 */
export function startTelemetry(config: AppConfig['otel']): () => Promise<void> {
  if (!config.enabled || !config.endpoint) return async () => {};
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': config.serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${config.endpoint.replace(/\/+$/, '')}/v1/traces` }),
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [],
  });
  sdk.start();
  return () => sdk.shutdown();
}
