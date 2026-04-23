FROM apify/actor-node-playwright-chrome:20

COPY package*.json ./
RUN npm --quiet set progress=false && npm install --include=dev --no-optional

COPY . ./
RUN npm run build && npm prune --production

CMD npm start
