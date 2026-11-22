FROM denoland/deno:2.4.2

WORKDIR /app
COPY supabase/functions ./supabase/functions
COPY railway/server.ts ./railway/server.ts
COPY railway/setup-webhook.ts ./railway/setup-webhook.ts

RUN deno cache --no-config --no-check railway/server.ts railway/setup-webhook.ts

USER deno
EXPOSE 8080
CMD ["run", "--allow-net", "--allow-env", "railway/server.ts"]
