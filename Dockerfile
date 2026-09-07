FROM docker.io/library/node:24-alpine
LABEL maintainer="XiaoXi <admin@soraharu.com>"
ENV ENV_PRODUCT=true
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=3001
ENV LOG_LEVEL=info
ENV PROJECT_NAME=node-server-falsework
COPY ./dist/index.js /home/node/app/
EXPOSE 3001/tcp
ENTRYPOINT [ "node", "/home/node/app/index.js" ]
