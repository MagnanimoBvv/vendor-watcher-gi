const axios = require('axios');
const FormData = require('form-data');

function makeShopifyFunctions(client) {
    async function getLocationId() {
        const res = await client.graphql(`
            query {
                locations(first: 10) {
                    nodes { id name }
                }
            }
        `);
        return res.data.locations.nodes[0].id;
    }

    async function getPublications() {
        const res = await client.graphql(`
            query {
                publications(first: 10) {
                    nodes { id name }
                }
            }
        `);
        return res.data.publications.nodes.map(c => ({ publicationId: c.id }));
    }

    async function getProductsByVendor(vendorName) {
        const products = [];
        let cursor = null;
        let hasNext = true;

        const query = `
            query ($cursor: String, $q: String!) {
                products(first: 100, after: $cursor, query: $q) {
                    pageInfo { hasNextPage endCursor }
                    nodes {
                        id
                        handle
                        title
                        status
                        tags
                        vendor
                        variants(first: 100) {
                            nodes {
                                id
                                title
                                price
                                compareAtPrice
                                sku
                                inventoryItem { id }
                                selectedOptions { name value }
                            }
                        }
                        metafields(first: 20, namespace: "custom") {
                            nodes { id key value type }
                        }
                    }
                }
            }
        `;

        while (hasNext) {
            const res = await client.graphql(query, {
                cursor,
                q: `vendor:${vendorName} status:active,draft`,
            });
            const page = res.data.products;
            products.push(...page.nodes);
            hasNext = page.pageInfo.hasNextPage;
            cursor = page.pageInfo.endCursor;
        }

        return products;
    }

    async function productByHandle(handle) {
        const res = await client.graphql(`
            query ($handle: String!) {
                productByHandle(handle: $handle) {
                    id
                    handle
                    title
                    status
                    tags
                    vendor
                    variants(first: 250) {
                        nodes {
                            id
                            title
                            price
                            compareAtPrice
                            sku
                            inventoryItem { id }
                            selectedOptions { name value }
                        }
                    }
                    metafields(first: 20, namespace: "custom") {
                        nodes { id key value type }
                    }
                }
            }
        `, { handle });
        return res.data.productByHandle;
    }

    async function setProductTags(productId, tags) {
        const res = await client.graphql(`
            mutation ($input: ProductInput!) {
                productUpdate(input: $input) {
                    product { id tags }
                    userErrors { field message }
                }
            }
        `, { input: { id: productId, tags } }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.productUpdate.userErrors;
            if (errs.length) console.error(`[setProductTags ${productId}]`, errs);
        }
        return res;
    }

    async function tagsAdd(productId, tags) {
        const res = await client.graphql(`
            mutation ($id: ID!, $tags: [String!]!) {
                tagsAdd(id: $id, tags: $tags) {
                    userErrors { field message }
                }
            }
        `, { id: productId, tags }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.tagsAdd.userErrors;
            if (errs.length) console.error(`[tagsAdd ${productId}]`, errs);
        }
        return res;
    }

    async function tagsRemove(productId, tags) {
        const res = await client.graphql(`
            mutation ($id: ID!, $tags: [String!]!) {
                tagsRemove(id: $id, tags: $tags) {
                    userErrors { field message }
                }
            }
        `, { id: productId, tags }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.tagsRemove.userErrors;
            if (errs.length) console.error(`[tagsRemove ${productId}]`, errs);
        }
        return res;
    }

    async function setProductStatus(productId, status) {
        const res = await client.graphql(`
            mutation ($input: ProductInput!) {
                productUpdate(input: $input) {
                    product { id status }
                    userErrors { field message }
                }
            }
        `, { input: { id: productId, status } }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.productUpdate.userErrors;
            if (errs.length) console.error(`[setProductStatus ${productId}]`, errs);
        }
        return res;
    }

    async function setMetafields(metafields) {
        const res = await client.graphql(`
            mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) {
                    metafields { id key value }
                    userErrors { field message }
                }
            }
        `, { metafields }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.metafieldsSet.userErrors;
            if (errs.length) console.error('[setMetafields]', errs);
        }
        return res;
    }

    async function deleteMetafield(identifier) {
        const res = await client.graphql(`
            mutation ($metafields: [MetafieldIdentifierInput!]!) {
                metafieldsDelete(metafields: $metafields) {
                    deletedMetafields { key namespace ownerId }
                    userErrors { field message }
                }
            }
        `, { metafields: [identifier] }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.metafieldsDelete.userErrors;
            if (errs.length) console.error('[deleteMetafield]', errs);
        }
        return res;
    }

    async function productVariantsBulkUpdate(productId, variants) {
        const res = await client.graphql(`
            mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                    productVariants { id title price compareAtPrice }
                    userErrors { field message }
                }
            }
        `, { productId, variants }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.productVariantsBulkUpdate.userErrors;
            if (errs.length) console.error(`[bulkUpdate ${productId}]`, errs);
        }
        return res;
    }

    async function productVariantsBulkCreate(productId, variants, strategy = 'REMOVE_STANDALONE_VARIANT') {
        const res = await client.graphql(`
            mutation ($productId: ID!, $strategy: ProductVariantsBulkCreateStrategy, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkCreate(productId: $productId, strategy: $strategy, variants: $variants) {
                    productVariants { id title }
                    userErrors { field message }
                }
            }
        `, { productId, strategy, variants }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.productVariantsBulkCreate.userErrors;
            if (errs.length) console.error(`[bulkCreate ${productId}]`, errs);
        }
        return res;
    }

    async function getProductMedia(productId) {
        const res = await client.graphql(`
            query ($id: ID!) {
                product(id: $id) {
                    media(first: 250) { nodes { id alt } }
                }
            }
        `, { id: productId });
        const p = res.data && res.data.product;
        return (p && p.media && p.media.nodes) || [];
    }

    async function productCreateMedia(productId, media) {
        if (client.dryRun) {
            console.log('[DRY-RUN] productCreateMedia:', productId, `(${media.length} media)`);
            return media.map((m, i) => ({ id: `gid://dry-run/Media/${i}`, alt: m.alt || '' }));
        }
        const res = await client.graphql(`
            mutation ($productId: ID!, $media: [CreateMediaInput!]!) {
                productCreateMedia(productId: $productId, media: $media) {
                    media { id alt }
                    mediaUserErrors { field message }
                }
            }
        `, { productId, media }, { isMutation: true });
        const payload = res.data.productCreateMedia;
        if (payload.mediaUserErrors && payload.mediaUserErrors.length) {
            console.error(`[productCreateMedia ${productId}]`, payload.mediaUserErrors);
        }
        return payload.media || [];
    }

    async function productDeleteMedia(productId, mediaIds) {
        const res = await client.graphql(`
            mutation ($productId: ID!, $mediaIds: [ID!]!) {
                productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
                    deletedMediaIds
                    mediaUserErrors { field message }
                }
            }
        `, { productId, mediaIds }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.productDeleteMedia && res.data.productDeleteMedia.mediaUserErrors;
            if (errs && errs.length) console.error(`[productDeleteMedia ${productId}]`, errs);
        }
        return res;
    }

    async function createStagedUpload(input) {
        const res = await client.graphql(`
            mutation ($input: [StagedUploadInput!]!) {
                stagedUploadsCreate(input: $input) {
                    stagedTargets {
                        url
                        resourceUrl
                        parameters { name value }
                    }
                    userErrors { field message }
                }
            }
        `, { input }, { isMutation: true });
        return res.data.stagedUploadsCreate.stagedTargets[0];
    }

    async function productCreate(input, media) {
        const res = await client.graphql(`
            mutation ($input: ProductInput!, $media: [CreateMediaInput!]) {
                productCreate(input: $input, media: $media) {
                    product {
                        id
                        handle
                        media(first: 250) { nodes { id alt } }
                    }
                    userErrors { field message }
                }
            }
        `, { input, media }, { isMutation: true });
        if (!client.dryRun) {
            const errs = res.data.productCreate.userErrors;
            if (errs.length) console.error('[productCreate]', errs);
        }
        return res.data.productCreate.product;
    }

    async function publishProduct(id, input) {
        const res = await client.graphql(`
            mutation ($id: ID!, $input: [PublicationInput!]!) {
                publishablePublish(id: $id, input: $input) {
                    publishable { availablePublicationsCount { count } }
                    userErrors { field message }
                }
            }
        `, { id, input }, { isMutation: true });
        return res.data && res.data.publishablePublish && res.data.publishablePublish.publishable;
    }

    async function uploadFileToStagedTarget(target, buffer, filename) {
        if (client.dryRun) {
            console.log('[DRY-RUN] uploadFileToStagedTarget:', filename);
            return target.resourceUrl;
        }
        const formData = new FormData();
        target.parameters.forEach(p => formData.append(p.name, p.value));
        formData.append('file', buffer, { filename });
        await axios.post(target.url, formData, { headers: formData.getHeaders() });
        return target.resourceUrl;
    }

    return {
        getLocationId,
        getPublications,
        getProductsByVendor,
        productByHandle,
        setProductTags,
        tagsAdd,
        tagsRemove,
        setProductStatus,
        setMetafields,
        deleteMetafield,
        productVariantsBulkUpdate,
        productVariantsBulkCreate,
        getProductMedia,
        productCreateMedia,
        productDeleteMedia,
        createStagedUpload,
        productCreate,
        publishProduct,
        uploadFileToStagedTarget,
    };
}

module.exports = { makeShopifyFunctions };
