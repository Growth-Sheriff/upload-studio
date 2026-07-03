#!/bin/bash

curl -s -X POST https://customizerapp.dev/api/upload/intent \
  -H "Content-Type: application/json" \
  -d '{"shopDomain":"fast-dtf-transfer.myshopify.com","fileName":"test.png","contentType":"image/png","fileSize":1024,"mode":"quick"}' | jq .
