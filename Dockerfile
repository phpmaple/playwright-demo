FROM mcr.microsoft.com/playwright:bionic
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY package.json package*.json ./
RUN npm install
ENV TZ=Asia/Shanghai
COPY . .
CMD [ "node", "shopee.js" ]