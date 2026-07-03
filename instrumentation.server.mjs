import * as Sentry from "@sentry/remix";

Sentry.init({
    dsn: "https://808c0fd1491e58940acad91a5c893df6@o4510838496821248.ingest.us.sentry.io/4510838504030208",
    tracesSampleRate: 1,

    enableLogs: true,
    integrations: [

        Sentry.consoleIntegration({ levels: ["log", "warn", "error"] }),
    ]
});