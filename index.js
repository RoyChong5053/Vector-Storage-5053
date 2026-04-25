import {
    eventSource,
    event_types,
    extension_prompt_types,
    extension_prompt_roles,
    getCurrentChatId,
    getRequestHeaders,
    is_send_press,
    saveSettingsDebounced,
    setExtensionPrompt,
    substituteParams,
    generateRaw,
    substituteParamsExtended,
} from '../../../script.js';
import {
    ModuleWorkerWrapper,
    extension_settings,
    getContext,
    modules,
    renderExtensionTemplateAsync,
    doExtrasFetch, getApiUrl,
    openThirdPartyExtensionMenu,
} from '../../extensions.js';
import { collapseNewlines, registerDebugFunction } from '../../power-user.js';
import { SECRET_KEYS, secret_state } from '../../secrets.js';
import { getDataBankAttachments, getDataBankAttachmentsForSource, getFileAttachment } from '../../chats.js';
import { debounce, getStringHash as calculateHash, waitUntilCondition, onlyUnique, splitRecursive, trimToStartSentence, trimToEndSentence, escapeHtml, isTrueBoolean } from '../../utils.js';
import { debounce_timeout } from '../../constants.js';
import { getSortedEntries } from '../../world-info.js';
import { textgen_types, textgenerationwebui_settings } from '../../textgen-settings.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue, enumTypes } from '../../slash-commands/SlashCommandEnumValue.js';
import { commonEnumProviders } from '../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { slashCommandReturnHelper } from '../../slash-commands/SlashCommandReturnHelper.js';
import { generateWebLlmChatPrompt, isWebLlmSupported } from '../shared.js';
import { WebLlmVectorProvider } from './webllm.js';
import { removeReasoningFromString } from '../../reasoning.js';
import { oai_settings } from '../../openai.js';

/**
 * @typedef {object} HashedMessage
 * @property {string} text - The hashed message text
 * @property {number} hash - The hash used as the vector key
 * @property {number} index - The index of the message in the chat
 */

const MODULE_NAME = 'vectors';

export const EXTENSION_PROMPT_TAG = '3_vectors';
export const EXTENSION_PROMPT_TAG_DB = '4_vectors_data_bank';

// Force solo chunks for sources that don't support batching.
const getBatchSize = () => ['transformers', 'ollama'].includes(settings.source) ? 1 : 5;

const settings = {
    // For both
    source: 'transformers',
    alt_endpoint_url: '',
    use_alt_endpoint: false,
    include_wi: false,
    togetherai_model: 'togethercomputer/m2-bert-80M-32k-retrieval',
    openai_model: 'text-embedding-ada-002',
    electronhub_model: 'text-embedding-3-small',
    openrouter_model: 'openai/text-embedding-3-large',
    cohere_model: 'embed-english-v3.0',
    ollama_model: 'mxbai-embed-large',
    ollama_keep: false,
    vllm_model: '',
    webllm_model: '',
    google_model: 'text-embedding-005',
    chutes_model: 'chutes-qwen-qwen3-embedding-8b',
    nanogpt_model: 'text-embedding-3-small',
    siliconflow_model: 'Qwen/Qwen3-Embedding-0.6B',
    summarize: false,
    summarize_sent: false,
    summary_source: 'main',
    summary_prompt: 'Ignore previous instructions. Summarize the most important parts of the message. Limit yourself to 250 words or less. Your response should include nothing but the summary.',
    force_chunk_delimiter: '',

    // For chats
    enabled_chats: false,
    template: 'Past events:\n{{text}}',
    depth: 2,
    position: extension_prompt_types.IN_PROMPT,
    protect: 5,
    insert: 3,
    query: 2,
    message_chunk_size: 400,
    score_threshold: 0.25,

    // For files
    enabled_files: false,
    translate_files: false,
    size_threshold: 10,
    chunk_size: 5000,
    chunk_count: 2,
    overlap_percent: 0,
    only_custom_boundary: false,

    // For Data Bank
    size_threshold_db: 5,
    chunk_size_db: 2500,
    chunk_count_db: 5,
    overlap_percent_db: 0,
    file_template_db: 'Related information:\n{{text}}',
    file_position_db: extension_prompt_types.IN_PROMPT,
    file_depth_db: 4,
    file_depth_role_db: extension_prompt_roles.SYSTEM,

    // For World Info
    enabled_world_info: false,
    enabled_for_all: false,
    max_entries: 5,
};

const moduleWorker = new ModuleWorkerWrapper(synchronizeChat);
const webllmProvider = new WebLlmVectorProvider();
const cachedSummaries = new Map();
const vectorApiRequiresUrl = ['llamacpp', 'vllm', 'ollama', 'koboldcpp'];

/**
 * Gets the Collection ID for a file embedded in the chat.
 * @param {string} fileUrl URL of the file
 * @returns {string} Collection ID
 */
function getFileCollectionId(fileUrl) {
    return `file_${getStringHash(fileUrl)}`;
}

async function onVectorizeAllClick() {
    try {
        if (!settings.enabled_chats) {
            return;
        }

        const chatId = getCurrentChatId();

        if (!chatId) {
            toastr.info('No chat selected', 'Vectorization aborted');
            return;
        }

        // Clear all cached summaries to ensure that new ones are created
        // upon request of a full vectorise
        cachedSummaries.clear();

        const batchSize = getBatchSize();
        const elapsedLog = [];
        let finished = false;
        $('#vectorize_progress').show();
        $('#vectorize_progress_percent').text('0');
        $('#vectorize_progress_eta').text('...');

        while (!finished) {
            if (is_send_press) {
                toastr.info('Message generation is in progress.', 'Vectorization aborted');
                throw new Error('Message generation is in progress.');
            }

            const startTime = Date.now();
            const remaining = await synchronizeChat(batchSize);
            const elapsed = Date.now() - startTime;
            elapsedLog.push(elapsed);
            finished = remaining <= 0;

            const total = getContext().chat.length;
            const processed = total - remaining;
            const processedPercent = Math.round((processed / total) * 100); // percentage of the work done
            const lastElapsed = elapsedLog.slice(-5); // last 5 elapsed times
            const averageElapsed = lastElapsed.reduce((a, b) => a + b, 0) / lastElapsed.length; // average time needed to process one item
            const pace = averageElapsed / batchSize; // time needed to process one item
            const remainingTime = Math.round(pace * remaining / 1000);

            $('#vectorize_progress_percent').text(processedPercent);
            $('#vectorize_progress_eta').text(remainingTime);

            if (chatId !== getCurrentChatId()) {
                throw new Error('Chat changed');
            }
        }
    } catch (error) {
        console.error('Vectors: Failed to vectorize all', error);
    } finally {
        $('#vectorize_progress').hide();
    }
}

let syncBlocked = false;

/**
 * Gets the chunk delimiters for splitting text.
 * @returns {string[]} Array of chunk delimiters
 */
function getChunkDelimiters() {
    const delimiters = ['\n\n', '\n', ' ', ''];

    if (settings.force_chunk_delimiter) {
        delimiters.unshift(settings.force_chunk_delimiter);
    }

    return delimiters;
}

/**
 * Splits messages into chunks before inserting them into the vector index.
 * @param {object[]} items Array of vector items
 * @returns {object[]} Array of vector items (possibly chunked)
 */
function splitByChunks(items) {
    if (settings.message_chunk_size <= 0) {
        return items;
    }

    const chunkedItems = [];

    for (const item of items) {
        const chunks = splitRecursive(item.text, settings.message_chunk_size, getChunkDelimiters());
        for (const chunk of chunks) {
            const chunkedItem = { ...item, text: chunk };
            chunkedItems.push(chunkedItem);
        }
    }

    return chunkedItems;
}

/**
 * Summarizes messages using the Extras API method.
 * @param {HashedMessage} element hashed message
 * @returns {Promise<boolean>} Sucess
 */
async function summarizeExtra(element) {
    try {
        const url = new URL(getApiUrl());
        url.pathname = '/api/summarize';

        const apiResult = await doExtrasFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Bypass-Tunnel-Reminder': 'bypass',
            },
            body: JSON.stringify({
                text: element.text,
                params: {},
            }),
        });

        if (apiResult.ok) {
            const data = await apiResult.json();
            element.text = data.summary;
        }
    } catch (error) {
        console.log(error);
        return false;
    }

    return true;
}

/**
 * Summarizes messages using the main API method.
 * @param {HashedMessage} element hashed message
 * @returns {Promise<boolean>} Success
 */
async function summarizeMain(element) {
    element.text = removeReasoningFromString(await generateRaw({ prompt: element.text, systemPrompt: settings.summary_prompt }));
    return true;
}

/**
 * Summarizes messages using WebLLM.
 * @param {HashedMessage} element hashed message
 * @returns {Promise<boolean>} Success
 */
async function summarizeWebLLM(element) {
    if (!isWebLlmSupported()) {
        console.warn('Vectors: WebLLM is not supported');
        return false;
    }

    const messages = [{ role: 'system', content: settings.summary_prompt }, { role: 'user', content: element.text }];
    element.text = await generateWebLlmChatPrompt(messages);

    return true;
}

/**
 * Summarizes messages using the chosen method.
 * @param {HashedMessage[]} hashedMessages Array of hashed messages
 * @param {string} endpoint Type of endpoint to use
 * @returns {Promise<HashedMessage[]>} Summarized messages
 */
async function summarize(hashedMessages, endpoint = 'main') {
    for (const element of hashedMessages) {
        const cachedSummary = cachedSummaries.get(element.hash);
        if (!cachedSummary) {
            let success = true;
            switch (endpoint) {
                case 'main':
                    success = await summarizeMain(element);
                    break;
                case 'extras':
                    success = await summarizeExtra(element);
                    break;
                case 'webllm':
                    success = await summarizeWebLLM(element);
                    break;
                default:
                    console.error('Unsupported endpoint', endpoint);
                    success = false;
                    break;
            }
            if (success) {
                cachedSummaries.set(element.hash, element.text);
            } else {
                break;
            }
        } else {
            element.text = cachedSummary;
        }
    }
    return hashedMessages;
}

async function synchronizeChat(batchSize = 5) {
    if (!settings.enabled_chats) {
        return -1;
    }

    try {
        await waitUntilCondition(() => !syncBlocked && !is_send_press, 1000);
    } catch {
        console.log('Vectors: Synchronization blocked by another process');
        return -1;
    }

    try {
        syncBlocked = true;
        const context = getContext();
        const chatId = getCurrentChatId();

        if (!chatId || !Array.isArray(context.chat)) {
            console.debug('Vectors: No chat selected');
            return -1;
        }

        const hashedMessages = context.chat.filter(x => !x.is_system).map(x => ({ text: String(substituteParams(x.mes)), hash: getStringHash(substituteParams(x.mes)), index: context.chat.indexOf(x) }));
        const hashesInCollection = await getSavedHashes(chatId);

        let newVectorItems = hashedMessages.filter(x => !hashesInCollection.includes(x.hash));
        const deletedHashes = hashesInCollection.filter(x => !hashedMessages.some(y => y.hash === x));

        if (settings.summarize) {
            newVectorItems = await summarize(newVectorItems, settings.summary_source);
        }

        if (newVectorItems.length > 0) {
            const chunkedBatch = splitByChunks(newVectorItems.slice(0, batchSize));

            console.log(`Vectors: Found ${newVectorItems.length} new items. Processing ${batchSize}...`);
            await insertVectorItems(chatId, chunkedBatch);
        }

        if (deletedHashes.length > 0) {
            await deleteVectorItems(chatId, deletedHashes);
            console.log(`Vectors: Deleted ${deletedHashes.length} old hashes`);
        }

        return newVectorItems.length - batchSize;
    } catch (error) {
        /**
         * Gets the error message for a given cause
         * @param {string} cause Error cause key
         * @returns {string} Error message
         */
        function getErrorMessage(cause) {
            switch (cause) {
                case 'api_key_missing':
                    return 'API key missing. Save it in the "API Connections" panel.';
                case 'api_url_missing':
                    return 'API URL missing. Save it in the "API Connections" panel.';
                case 'api_model_missing':
                    return 'Vectorization Source Model is required, but not set.';
                case 'extras_module_missing':
                    return 'Extras API must provide an "embeddings" module.';
                case 'webllm_not_supported':
                    return 'WebLLM extension is not installed or the model is not set.';
                default:
                    return 'Check server console for more details';
            }
        }

        console.error('Vectors: Failed to synchronize chat', error);

        const message = getErrorMessage(error.cause);
        toastr.error(message, 'Vectorization failed', { preventDuplicates: true });
        return -1;
    } finally {
        syncBlocked = false;
    }
}

/**
 * @type {Map<string, number>} Cache object for storing hash values
 */
const hashCache = new Map();

/**
 * Gets the hash value for a given string
 * @param {string} str Input string
 * @returns {number} Hash value
 */
function getStringHash(str) {
    // Check if the hash is already in the cache
    if (hashCache.has(str)) {
        return hashCache.get(str);
    }

    // Calculate the hash value
    const hash = calculateHash(str);

    // Store the hash in the cache
    hashCache.set(str, hash);

    return hash;
}

/**
 * Retrieves files from the chat and inserts them into the vector index.
 * @param {ChatMessage[]} chat Array of chat messages
 * @returns {Promise<void>}
 */
async function processFiles(chat) {
    try {
        if (!settings.enabled_files) {
            return;
        }

        const dataBankCollectionIds = await ingestDataBankAttachments();

        if (dataBankCollectionIds.length) {
            const queryText = await getQueryText(chat, 'file');
            await injectDataBankChunks(queryText, dataBankCollectionIds);
        }

        for (const message of chat) {
            // Message has no files
            if (!Array.isArray(message?.extra?.files) || !message.extra.files.length) {
                continue;
            }

            // Trim file inserted by the script
            const allFileText = String(message.mes || '').substring(0, message.extra.fileLength).trim();

            // Convert kilobytes to string length
            const thresholdLength = settings.size_threshold * 1024;

            // File is too small
            if (allFileText.length < thresholdLength) {
                continue;
            }

            message.mes = message.mes.substring(message.extra.fileLength);

            const allFileChunks = [];
            const queryText = await getQueryText(chat, 'file');

            for (const file of message.extra.files) {
                const fileName = file.name;
                const fileUrl = file.url;
                const collectionId = getFileCollectionId(fileUrl);
                const hashesInCollection = await getSavedHashes(collectionId);

                // File is not vectorized yet
                if (!hashesInCollection.length) {
                    const fileText = file.text || (await getFileAttachment(fileUrl));
                    if (!fileText) {
                        continue;
                    }
                    await vectorizeFile(fileText, fileName, collectionId, settings.chunk_size, settings.overlap_percent);
                }

                const fileChunks = await retrieveFileChunks(queryText, collectionId);
                if (fileChunks) {
                    allFileChunks.push(fileChunks);
                }
            }

            message.mes = `${allFileChunks.join('\n\n')}\n\n${message.mes}`;
        }
    } catch (error) {
        console.error('Vectors: Failed to retrieve files', error);
    }
}

/**
 * Ensures that data bank attachments are ingested and inserted into the vector index.
 * @param {string} [source] Optional source filter for data bank attachments.
 * @returns {Promise<string[]>} Collection IDs
 */
async function ingestDataBankAttachments(source) {
    // Exclude disabled files
    const dataBank = source ? getDataBankAttachmentsForSource(source, false) : getDataBankAttachments(false);
    const dataBankCollectionIds = [];

    for (const file of dataBank) {
        const collectionId = getFileCollectionId(file.url);
        const hashesInCollection = await getSavedHashes(collectionId);
        dataBankCollectionIds.push(collectionId);

        // File is already in the collection
        if (hashesInCollection.length) {
            continue;
        }

        // Download and process the file
        const fileText = await getFileAttachment(file.url);
        console.log(`Vectors: Retrieved file ${file.name} from Data Bank`);
        // Convert kilobytes to string length
        const thresholdLength = settings.size_threshold_db * 1024;
        // Use chunk size from settings if file is larger than threshold
        const chunkSize = file.size > thresholdLength ? settings.chunk_size_db : -1;
        await vectorizeFile(fileText, file.name, collectionId, chunkSize, settings.overlap_percent_db);
    }

    return dataBankCollectionIds;
}

/**
 * Inserts file chunks from the Data Bank into the prompt.
 * @param {string} queryText Text to query
 * @param {string[]} collectionIds File collection IDs
 * @returns {Promise<void>}
 */
async function injectDataBankChunks(queryText, collectionIds) {
    try {
        const queryResults = await queryMultipleCollections(collectionIds, queryText, settings.chunk_count_db, settings.score_threshold);
        console.debug(`Vectors: Retrieved ${collectionIds.length} Data Bank collections`, queryResults);
        let textResult = '';

        for (const collectionId in queryResults) {
            console.debug(`Vectors: Processing Data Bank collection ${collectionId}`, queryResults[collectionId]);
            const metadata = queryResults[collectionId].metadata?.filter(x => x.text)?.sort((a, b) => a.index - b.index)?.map(x => x.text)?.filter(onlyUnique) || [];
            textResult += metadata.join('\n') + '\n\n';
        }

        if (!textResult) {
            console.debug('Vectors: No Data Bank chunks found');
            return;
        }

        const insertedText = substituteParamsExtended(settings.file_template_db, { text: textResult });
        setExtensionPrompt(EXTENSION_PROMPT_TAG_DB, insertedText, settings.file_position_db, settings.file_depth_db, settings.include_wi, settings.file_depth_role_db);
    } catch (error) {
        console.error('Vectors: Failed to insert Data Bank chunks', error);
    }
}

/**
 * Retrieves file chunks from the vector index and inserts them into the chat.
 * @param {string} queryText Text to query
 * @param {string} collectionId File collection ID
 * @returns {Promise<string>} Retrieved file text
 */
async function retrieveFileChunks(queryText, collectionId) {
    console.debug(`Vectors: Retrieving file chunks for collection ${collectionId}`, queryText);
    const queryResults = await queryCollection(collectionId, queryText, settings.chunk_count);
    console.debug(`Vectors: Retrieved ${queryResults.hashes.length} file chunks for collection ${collectionId}`, queryResults);
    const metadata = queryResults.metadata.filter(x => x.text).sort((a, b) => a.index - b.index).map(x => x.text).filter(onlyUnique);
    const fileText = metadata.join('\n');

    return fileText;
}

/**
 * Vectorizes a file and inserts it into the vector index.
 * @param {string} fileText File text
 * @param {string} fileName File name
 * @param {string} collectionId File collection ID
 * @param {number} chunkSize Chunk size
 * @param {number} overlapPercent Overlap size (in %)
 * @returns {Promise<boolean>} True if successful, false if not
 */
async function vectorizeFile(fileText, fileName, collectionId, chunkSize, overlapPercent) {
    let toast = jQuery();

    try {
        if (settings.translate_files && typeof globalThis.translate === 'function') {
            console.log(`Vectors: Translating file ${fileName} to English...`);
            const translatedText = await globalThis.translate(fileText, 'en');
            fileText = translatedText;
        }

        const batchSize = getBatchSize();
        const toastBody = $('<span>').text('This may take a while. Please wait...');
        toast = toastr.info(toastBody, `Ingesting file ${escapeHtml(fileName)}`, { closeButton: false, escapeHtml: false, timeOut: 0, extendedTimeOut: 0 });
        const overlapSize = Math.round(chunkSize * overlapPercent / 100);
        const delimiters = getChunkDelimiters();
        // Overlap should not be included in chunk size. It will be later compensated by overlapChunks
        chunkSize = overlapSize > 0 ? (chunkSize - overlapSize) : chunkSize;
        const applyOverlap = (x, y, z) => overlapSize > 0 ? overlapChunks(x, y, z, overlapSize) : x;
        const chunks = settings.only_custom_boundary && settings.force_chunk_delimiter
            ? fileText.split(settings.force_chunk_delimiter).map(applyOverlap)
            : splitRecursive(fileText, chunkSize, delimiters).map(applyOverlap);
        console.debug(`Vectors: Split file ${fileName} into ${chunks.length} chunks with ${overlapPercent}% overlap`, chunks);

        const items = chunks.map((chunk, index) => ({ hash: getStringHash(chunk), text: chunk, index: index }));

        for (let i = 0; i < items.length; i += batchSize) {
            toastBody.text(`${i}/${items.length} (${Math.round((i / items.length) * 100)}%) chunks processed`);
            const chunkedBatch = items.slice(i, i + batchSize);
            await insertVectorItems(collectionId, chunkedBatch);
        }

        toastr.clear(toast);
        console.log(`Vectors: Inserted ${chunks.length} vector items for file ${fileName} into ${collectionId}`);
        return true;
    } catch (error) {
        toastr.clear(toast);
        toastr.error(String(error), 'Failed to vectorize file', { preventDuplicates: true });
        console.error('Vectors: Failed to vectorize file', error);
        return false;
    }
}

/**
 * Removes the most relevant messages from the chat and displays them in the extension prompt
 * @param {ChatMessage[]} chat Array of chat messages
 * @param {number} _contextSize Context size (unused)
 * @param {function} _abort Abort function (unused)
 * @param {string} type Generation type
 */
async function rearrangeChat(chat, _contextSize, _abort, type) {
    try {
        if (type === 'quiet') {
            console.debug('Vectors: Skipping quiet prompt');
            return;
        }

        // Clear the extension prompt
        setExtensionPrompt(EXTENSION_PROMPT_TAG, '', settings.position, settings.depth, settings.include_wi);
        setExtensionPrompt(EXTENSION_PROMPT_TAG_DB, '', settings.file_position_db, settings.file_depth_db, settings.include_wi, settings.file_depth_role_db);

        if (settings.enabled_files) {
            await processFiles(chat);
        }

        if (settings.enabled_world_info) {
            await activateWorldInfo(chat);
        }

        if (!settings.enabled_chats) {
            return;
        }

        const chatId = getCurrentChatId();

        if (!chatId || !Array.isArray(chat)) {
            console.debug('Vectors: No chat selected');
            return;
        }

        if (chat.length < settings.protect) {
            console.debug(`Vectors: Not enough messages to rearrange (less than ${settings.protect})`);
            return;
        }

        const queryText = await getQueryText(chat, 'chat');

        if (queryText.length === 0) {
            console.debug('Vectors: No text to query');
            return;
        }

        // Get the most relevant messages, excluding the last few
        const queryResults = await queryCollection(chatId, queryText, settings.insert);
        const queryHashes = queryResults.hashes.filter(onlyUnique);
        const queriedMessages = [];
        const insertedHashes = new Set();
        const retainMessages = chat.slice(-settings.protect);

        for (const message of chat) {
            if (retainMessages.includes(message) || !message.mes) {
                continue;
            }
            const hash = getStringHash(substituteParams(message.mes));
            if (queryHashes.includes(hash) && !insertedHashes.has(hash)) {
                queriedMessages.push(message);
                insertedHashes.add(hash);
            }
        }

        // Rearrange queried messages to match query order
        // Order is reversed because more relevant are at the lower indices
        queriedMessages.sort((a, b) => queryHashes.indexOf(getStringHash(substituteParams(b.mes))) - queryHashes.indexOf(getStringHash(substituteParams(a.mes))));

        // Remove queried messages from the original chat array
        for (const message of chat) {
            if (queriedMessages.includes(message)) {
                chat.splice(chat.indexOf(message), 1);
            }
        }

        if (queriedMessages.length === 0) {
            console.debug('Vectors: No relevant messages found');
            return;
        }

        // Format queried messages into a single string
        const insertedText = getPromptText(queriedMessages);
        setExtensionPrompt(EXTENSION_PROMPT_TAG, insertedText, settings.position, settings.depth, settings.include_wi);
    } catch (error) {
        toastr.error('Generation interceptor aborted. Check browser console for more details.', 'Vector Storage');
        console.error('Vectors: Failed to rearrange chat', error);
    }
}

/**
 * @param {any[]} queriedMessages
 * @returns {string}
 */
function getPromptText(queriedMessages) {
    const queriedText = queriedMessages.map(x => collapseNewlines(`${x.name}: ${x.mes}`).trim()).join('\n\n');
    console.log('Vectors: relevant past messages found.\n', queriedText);
    return substituteParamsExtended(settings.template, { text: queriedText });
}

/**
 * Modifies text chunks to include overlap with adjacent chunks.
 * @param {string} chunk Current item
 * @param {number} index Current index
 * @param {string[]} chunks List of chunks
 * @param {number} overlapSize Size of the overlap
 * @returns {string} Overlapped chunks, with overlap trimmed to sentence boundaries
 */
function overlapChunks(chunk, index, chunks, overlapSize) {
    const halfOverlap = Math.floor(overlapSize / 2);
    const nextChunk = chunks[index + 1];
    const prevChunk = chunks[index - 1];

    const nextOverlap = trimToEndSentence(nextChunk?.substring(0, halfOverlap)) || '';
    const prevOverlap = trimToStartSentence(prevChunk?.substring(prevChunk.length - halfOverlap)) || '';
    const overlappedChunk = [prevOverlap, chunk, nextOverlap].filter(x => x).join(' ');

    return overlappedChunk;
}

globalThis.vectors_rearrangeChat = rearrangeChat;

const onChatEvent = debounce(async () => await moduleWorker.update(), debounce_timeout.relaxed);

/**
 * Gets the text to query from the chat
 * @param {ChatMessage[]} chat Chat messages
 * @param {'file'|'chat'|'world-info'} initiator Initiator of the query
 * @returns {Promise<string>} Text to query
 */
async function getQueryText(chat, initiator) {
    const getTextWithoutAttachments = (x) => {
        const fileLength = x?.extra?.fileLength || 0;
        return String(x?.mes || '').substring(fileLength).trim();
    };

    let hashedMessages = chat
        .map(x => ({ text: substituteParams(getTextWithoutAttachments(x)), hash: getStringHash(substituteParams(getTextWithoutAttachments(x))), index: chat.indexOf(x) }))
        .filter(x => x.text)
        .reverse()
        .slice(0, settings.query);

    if (initiator === 'chat' && settings.enabled_chats && settings.summarize && settings.summarize_sent) {
        hashedMessages = await summarize(hashedMessages, settings.summary_source);
    }

    const queryText = hashedMessages.map(x => x.text).join('\n');

    return collapseNewlines(queryText).trim();
}

/**
 * Gets common body parameters for vector requests.
 * @param {object} args Additional arguments
 * @returns {object} Request body
 */
function getVectorsRequestBody(args = {}) {
    const body = Object.assign({}, args);
    switch (settings.source) {
        case 'extras':
            body.extrasUrl = extension_settings.apiUrl;
            body.extrasKey = extension_settings.apiKey;
            break;
        case 'electronhub':
            body.model = extension_settings.vectors.electronhub_model;
            break;
        case 'openrouter':
            body.model = extension_settings.vectors.openrouter_model;
            break;
        case 'togetherai':
            body.model = extension_settings.vectors.togetherai_model;
            break;
        case 'openai':
            body.model = extension_settings.vectors.openai_model;
            break;
        case 'cohere':
            body.model = extension_settings.vectors.cohere_model;
            break;
        case 'ollama':
            body.model = extension_settings.vectors.ollama_model;
            body.apiUrl = settings.use_alt_endpoint ? settings.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.OLLAMA];
            body.keep = !!extension_settings.vectors.ollama_keep;
            break;
        case 'llamacpp':
            body.apiUrl = settings.use_alt_endpoint ? settings.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP];
            break;
        case 'vllm':
            body.apiUrl = settings.use_alt_endpoint ? settings.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.VLLM];
            body.model = extension_settings.vectors.vllm_model;
            break;
        case 'webllm':
            body.model = extension_settings.vectors.webllm_model;
            break;
        case 'palm':
            body.model = extension_settings.vectors.google_model;
            body.api = 'makersuite';
            break;
        case 'vertexai':
            body.model = extension_settings.vectors.google_model;
            body.api = 'vertexai';
            body.vertexai_auth_mode = oai_settings.vertexai_auth_mode;
            body.vertexai_region = oai_settings.vertexai_region;
            body.vertexai_express_project_id = oai_settings.vertexai_express_project_id;
            break;
        case 'chutes':
            body.model = extension_settings.vectors.chutes_model;
            break;
        case 'nanogpt':
            body.model = extension_settings.vectors.nanogpt_model;
            break;
        case 'siliconflow':
            body.model = extension_settings.vectors.siliconflow_model;
            body.siliconflow_endpoint = oai_settings.siliconflow_endpoint;
            break;
        default:
            break;
    }
    return body;
}

/**
 * Gets additional arguments for vector requests.
 * @param {string[]} items Items to embed
 * @returns {Promise<object>} Additional arguments
 */
async function getAdditionalArgs(items) {
    const args = {};
    switch (settings.source) {
        case 'webllm':
            args.embeddings = await createWebLlmEmbeddings(items);
            break;
        case 'koboldcpp': {
            const { embeddings, model } = await createKoboldCppEmbeddings(items);
            args.embeddings = embeddings;
            args.model = model;
            break;
        }
    }
    return args;
}

/**
 * Gets the saved hashes for a collection
* @param {string} collectionId
* @returns {Promise<number[]>} Saved hashes
*/
async function getSavedHashes(collectionId) {
    const args = await getAdditionalArgs([]);
    const response = await fetch('/api/vector/list', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to get saved hashes for collection ${collectionId}`);
    }

    const hashes = await response.json();
    return hashes;
}

/**
 * Inserts vector items into a collection
 * @param {string} collectionId - The collection to insert into
 * @param {{ hash: number, text: string }[]} items - The items to insert
 * @returns {Promise<void>}
 */
async function insertVectorItems(collectionId, items) {
    throwIfSourceInvalid();

    const args = await getAdditionalArgs(items.map(x => x.text));
    const response = await fetch('/api/vector/insert', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            items: items,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to insert vector items for collection ${collectionId}`);
    }
}

/**
 * Throws an error if the source is invalid (missing API key or URL, or missing module)
 */
function throwIfSourceInvalid() {
    if (settings.source === 'openai' && !secret_state[SECRET_KEYS.OPENAI] ||
        settings.source === 'electronhub' && !secret_state[SECRET_KEYS.ELECTRONHUB] ||
        settings.source === 'chutes' && !secret_state[SECRET_KEYS.CHUTES] ||
        settings.source === 'nanogpt' && !secret_state[SECRET_KEYS.NANOGPT] ||
        settings.source === 'openrouter' && !secret_state[SECRET_KEYS.OPENROUTER] ||
        settings.source === 'palm' && !secret_state[SECRET_KEYS.MAKERSUITE] ||
        settings.source === 'vertexai' && !secret_state[SECRET_KEYS.VERTEXAI] && !secret_state[SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT] ||
        settings.source === 'mistral' && !secret_state[SECRET_KEYS.MISTRALAI] ||
        settings.source === 'togetherai' && !secret_state[SECRET_KEYS.TOGETHERAI] ||
        settings.source === 'nomicai' && !secret_state[SECRET_KEYS.NOMICAI] ||
        settings.source === 'cohere' && !secret_state[SECRET_KEYS.COHERE] ||
        settings.source === 'siliconflow' && !secret_state[SECRET_KEYS.SILICONFLOW]) {
        throw new Error('Vectors: API key missing', { cause: 'api_key_missing' });
    }

    if (vectorApiRequiresUrl.includes(settings.source) && settings.use_alt_endpoint) {
        if (!settings.alt_endpoint_url) {
            throw new Error('Vectors: API URL missing', { cause: 'api_url_missing' });
        }
    } else {
        if (settings.source === 'ollama' && !textgenerationwebui_settings.server_urls[textgen_types.OLLAMA] ||
            settings.source === 'vllm' && !textgenerationwebui_settings.server_urls[textgen_types.VLLM] ||
            settings.source === 'koboldcpp' && !textgenerationwebui_settings.server_urls[textgen_types.KOBOLDCPP] ||
            settings.source === 'llamacpp' && !textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP]) {
            throw new Error('Vectors: API URL missing', { cause: 'api_url_missing' });
        }
    }

    if (settings.source === 'ollama' && !settings.ollama_model || settings.source === 'vllm' && !settings.vllm_model) {
        throw new Error('Vectors: API model missing', { cause: 'api_model_missing' });
    }

    if (settings.source === 'extras' && !modules.includes('embeddings')) {
        throw new Error('Vectors: Embeddings module missing', { cause: 'extras_module_missing' });
    }

    if (settings.source === 'webllm' && (!isWebLlmSupported() || !settings.webllm_model)) {
        throw new Error('Vectors: WebLLM is not supported', { cause: 'webllm_not_supported' });
    }
}

/**
 * Deletes vector items from a collection
 * @param {string} collectionId - The collection to delete from
 * @param {number[]} hashes - The hashes of the items to delete
 * @returns {Promise<void>}
 */
async function deleteVectorItems(collectionId, hashes) {
    const response = await fetch('/api/vector/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(),
            collectionId: collectionId,
            hashes: hashes,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to delete vector items for collection ${collectionId}`);
    }
}

/**
 * @param {string} collectionId - The collection to query
 * @param {string} searchText - The text to query
 * @param {number} topK - The number of results to return
 * @returns {Promise<{ hashes: number[], metadata: object[]}>} - Hashes of the results
 */
async function queryCollection(collectionId, searchText, topK) {
    const args = await getAdditionalArgs([searchText]);
    const response = await fetch('/api/vector/query', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            searchText: searchText,
            topK: topK,
            source: settings.source,
            threshold: settings.score_threshold,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to query collection ${collectionId}`);
    }

    return await response.json();
}

/**
 * Queries multiple collections for a given text.
 * @param {string[]} collectionIds - Collection IDs to query
 * @param {string} searchText - Text to query
 * @param {number} topK - Number of results to return
 * @param {number} threshold - Score threshold
 * @returns {Promise<Record<string, { hashes: number[], metadata: object[] }>>} - Results mapped to collection IDs
 */
/**
 * Queries multiple collections for a given text.
 * @param {string[]} collectionIds - The collection IDs to query
 * @param {string} searchText - The text to query
 * @param {number} topK - The number of results to return
 * @param {number} threshold - The threshold to use
 * @returns {Promise<{ hashes: number[], metadata: object[]}>} - Hashes of the results
 */
async function queryMultipleCollections(collectionIds, searchText, topK, threshold) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            const results = await lancedbBackend.queryMultipleCollections(collectionIds, searchText, topK, threshold);
            if (results.length > 0) {
                console.log("Vectors: Using LanceDB backend");
                return results;
            }
        } catch (error) {
            console.error("Vectors: LanceDB backend failed, falling back to API", error);
        }
    }

    const args = await getAdditionalArgs([searchText]);
    const response = await fetch("/api/vector/query-multi", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionIds: collectionIds,
            searchText: searchText,
            topK: topK,
            source: settings.source,
            threshold: threshold || settings.score_threshold,
        }),
    });

    if (!response.ok) {
        throw new Error("Failed to query multiple collections");
    }

    return await response.json();
}

/**
 * Purges the vector index for a file.
 * @param {string} fileUrl File URL to purge
 */
async function purgeFileVectorIndex(fileUrl) {
    try {
        if (!settings.enabled_files) {
            return;
        }

        console.log(`Vectors: Purging file vector index for ${fileUrl}`);
        const collectionId = getFileCollectionId(fileUrl);

        const response = await fetch('/api/vector/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(),
                collectionId: collectionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Could not delete vector index for collection ${collectionId}`);
        }

        console.log(`Vectors: Purged vector index for collection ${collectionId}`);
    } catch (error) {
        console.error('Vectors: Failed to purge file', error);
    }
}

/**
 * Purges the vector index for a collection.
 * @param {string} collectionId Collection ID to purge
 * @returns <Promise<boolean>> True if deleted, false if not
 */
async function purgeVectorIndex(collectionId) {
    try {
        if (!settings.enabled_chats) {
            return true;
        }

        const response = await fetch('/api/vector/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(),
                collectionId: collectionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Could not delete vector index for collection ${collectionId}`);
        }

        console.log(`Vectors: Purged vector index for collection ${collectionId}`);
        return true;
    } catch (error) {
        console.error('Vectors: Failed to purge', error);
        return false;
    }
}

/**
 * Purges all vector indexes.
 */
async function purgeAllVectorIndexes() {
    try {
        const response = await fetch('/api/vector/purge-all', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(),
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to purge all vector indexes');
        }

        console.log('Vectors: Purged all vector indexes');
        toastr.success('All vector indexes purged', 'Purge successful');
    } catch (error) {
        console.error('Vectors: Failed to purge all', error);
        toastr.error('Failed to purge all vector indexes', 'Purge failed');
    }
}

function toggleSettings() {
    $('#vectors_files_settings').toggle(!!settings.enabled_files);
    $('#vectors_chats_settings').toggle(!!settings.enabled_chats);
    $('#vectors_world_info_settings').toggle(!!settings.enabled_world_info);
    $('#together_vectorsModel').toggle(settings.source === 'togetherai');
    $('#openai_vectorsModel').toggle(settings.source === 'openai');
    $('#electronhub_vectorsModel').toggle(settings.source === 'electronhub');
    $('#chutes_vectorsModel').toggle(settings.source === 'chutes');
    $('#nanogpt_vectorsModel').toggle(settings.source === 'nanogpt');
    $('#openrouter_vectorsModel').toggle(settings.source === 'openrouter');
    $('#cohere_vectorsModel').toggle(settings.source === 'cohere');
    $('#ollama_vectorsModel').toggle(settings.source === 'ollama');
    $('#llamacpp_vectorsModel').toggle(settings.source === 'llamacpp');
    $('#vllm_vectorsModel').toggle(settings.source === 'vllm');
    $('#nomicai_apiKey').toggle(settings.source === 'nomicai');
    $('#webllm_vectorsModel').toggle(settings.source === 'webllm');
    $('#koboldcpp_vectorsModel').toggle(settings.source === 'koboldcpp');
    $('#google_vectorsModel').toggle(settings.source === 'palm' || settings.source === 'vertexai');
    $('#siliconflow_vectorsModel').toggle(settings.source === 'siliconflow');
    $('#vector_altEndpointUrl').toggle(vectorApiRequiresUrl.includes(settings.source));
    switch (settings.source) {
        case 'webllm':
            loadWebLlmModels();
            break;
        case 'electronhub':
            loadElectronHubModels();
            break;
        case 'openrouter':
            loadOpenRouterModels();
            break;
        case 'chutes':
            loadChutesModels();
            break;
        case 'nanogpt':
            loadNanoGPTModels();
            break;
        case 'siliconflow':
            loadSiliconFlowModels();
            break;
    }
}

async function loadChutesModels() {
    try {
        const response = await fetch('/api/openai/chutes/models/embedding', {
            method: 'POST',
            headers: getRequestHeaders({ omitContentType: true }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        /** @type {Array<any>} */
        const data = await response.json();
        const models = Array.isArray(data) ? data : [];
        populateChutesModelSelect(models);
    } catch (err) {
        console.warn('Chutes models fetch failed', err);
        populateChutesModelSelect([]);
    }
}

function populateChutesModelSelect(models) {
    const select = $('#vectors_chutes_model');
/**
 * Gets the saved hashes for a collection
 * @param {string} collectionId
 * @returns {Promise<number[]>} Saved hashes
 */
async function getSavedHashes(collectionId) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            const hashes = await lancedbBackend.list(collectionId);
            if (hashes.length > 0) {
                console.log('Vectors: Using LanceDB backend');
                return hashes;
            }
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    // Fallback to official API
    const args = await getAdditionalArgs([]);
    const response = await fetch('/api/vector/list', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to get saved hashes for collection ${collectionId}`);
    }

    const hashes = await response.json();
    return hashes;
}

/**
 * Inserts vector items into a collection
 * @param {string} collectionId - The collection to insert into
 * @param {{ hash: number, text: string }[]} items - The items to insert
 * @returns {Promise<void>}
 */
async function insertVectorItems(collectionId, items) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.insert(collectionId, items);
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    throwIfSourceInvalid();

    const args = await getAdditionalArgs(items.map(x => x.text));
    const response = await fetch('/api/vector/insert', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            items: items,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to insert vector items for collection ${collectionId}`);
    }
}

/**
 * Deletes vector items from a collection
 * @param {string} collectionId - The collection to delete from
 * @param {number[]} hashes - The hashes of the items to delete
 * @returns {Promise<void>}
 */
async function deleteVectorItems(collectionId, hashes) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.delete(collectionId, hashes);
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const response = await fetch('/api/vector/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(),
            collectionId: collectionId,
            hashes: hashes,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to delete vector items for collection ${collectionId}`);
    }
}

/**
 * @param {string} collectionId - The collection to query
 * @param {string} searchText - The text to query
 * @param {number} topK - The number of results to return
 * @returns {Promise<{ hashes: number[], metadata: object[]}>} - Hashes of the results
 */
async function queryCollection(collectionId, searchText, topK) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            const results = await lancedbBackend.query(collectionId, searchText, topK, settings.score_threshold);
            if (results.length > 0) {
                console.log('Vectors: Using LanceDB backend');
                return results;
            }
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const args = await getAdditionalArgs([searchText]);
    const response = await fetch('/api/vector/query', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            searchText: searchText,
            topK: topK,
            source: settings.source,
            threshold: settings.score_threshold,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to query collection ${collectionId}`);
    }

    return await response.json();
}

/**
 * Queries multiple collections for a given text.
 * @param {string[]} collectionIds - The collection IDs to query
 * @param {string} searchText - The text to query
 * @param {number} topK - The number of results to return
 * @param {number} threshold - The threshold to use
 * @returns {Promise<{ hashes: number[], metadata: object[]}>} - Hashes of the results
 */
async function queryMultipleCollections(collectionIds, searchText, topK, threshold) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            const results = await lancedbBackend.queryMultipleCollections(collectionIds, searchText, topK, threshold);
            if (results.length > 0) {
                console.log('Vectors: Using LanceDB backend');
                return results;
            }
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const args = await getAdditionalArgs([searchText]);
    const response = await fetch('/api/vector/query-multi', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionIds: collectionIds,
            searchText: searchText,
            topK: topK,
            source: settings.source,
            threshold: threshold || settings.score_threshold,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to query multiple collections`);
    }

    return await response.json();
}

/**
 * Purges file vector index
 * @param {string} fileUrl - The URL of the file
 * @returns {Promise<void>}
 */
async function purgeFileVectorIndex(fileUrl) {
    const collectionId = getFileCollectionId(fileUrl);

    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.purge(collectionId);
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const response = await fetch('/api/vector/purge', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(),
            collectionId: collectionId,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to purge file vector index for ${fileUrl}`);
    }
}

/**
 * Purges vector index
 * @param {string} collectionId - The collection ID to purge
 * @returns {Promise<void>}
 */
async function purgeVectorIndex(collectionId) {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.purge(collectionId);
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const response = await fetch('/api/vector/purge', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(),
            collectionId: collectionId,
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to purge vector index for ${collectionId}`);
    }
}

/**
 * Purges all vector indexes
 * @returns {Promise<void>}
 */
async function purgeAllVectorIndexes() {
    // Check if using LanceDB backend
    if (settings.useLanceDB) {
        try {
            // Try LanceDB backend first
            await lancedbBackend.purgeAll();
            console.log('Vectors: Using LanceDB backend');
            return;
        } catch (error) {
            console.error('Vectors: LanceDB backend failed, falling back to API', error);
        }
    }

    const response = await fetch('/api/vector/purge-all', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...getVectorsRequestBody(),
            source: settings.source,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to purge all vector indexes`);
    }
}

// Initialize LanceDB Backend
let lancedbBackend = null;

/**
 * Initializes the LanceDB backend if enabled
 */
async function initLanceDBBackend() {
    if (!settings.useLanceDB || !lancedbBackend) {
        return;
    }

    try {
        lancedbBackend = new LanceDBBackend({});
        lancedbBackend.init(getRequestHeaders);
        
        // Test connection
        const health = await lancedbBackend.healthCheck();
        if (health.healthy) {
            console.log('Vectors: LanceDB backend initialized successfully:', health.message);
        } else {
            console.warn('Vectors: LanceDB backend warning:', health.message);
        }
    } catch (error) {
        console.error('Vectors: Failed to initialize LanceDB backend:', error);
    }
}

// Export initialization function
window.initLanceDBBackend = initLanceDBBackend;
window.lancedbBackend = lancedbBackend;
window.lancedbBackendClass = LanceDBBackend;
window.VectorBackend = VectorBackend;
window.BackendFactory = BackendFactory;
