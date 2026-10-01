FROM node:24-alpine

ARG KEV_VERSION=1.0.0

ENV NODE_ENV=production \
    KEV_HOST=0.0.0.0 \
    KEV_PORT=3000 \
    KEV_BACKEND=mock

# LM Studio rejects response_format {type: "json_object"} (only json_schema/text),
# so disable Kev's JSON mode by default; prompts already demand JSON-only output.
RUN npm install -g --omit=dev "@kev-ai/server@${KEV_VERSION}" \
 && npm cache clean --force \
 && cd "$(npm root -g)/@kev-ai/server/dist" \
 && grep -l 'supportsJsonMode ?? true' *.js | xargs sed -i 's/supportsJsonMode ?? true/supportsJsonMode ?? false/' \
 && ! grep -q 'supportsJsonMode ?? true' *.js

USER node
WORKDIR /home/node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${KEV_PORT}/health" >/dev/null || exit 1

CMD ["kev-server"]
