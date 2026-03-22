/// <reference types="gapi" />
/// <reference types="google.accounts" />

/* global google, gapi */

const CLIENT_ID = '995009580603-fubh48cuga5gqhersounc5tp62in0a5u.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const FOLDER_NAME = 'AI_Diary_Backups';
const FILE_NAME = 'diary_state.json';

let tokenClient: any;
let gapiInited = false;
let gisInited = false;
let onAuthChangeCallback: ((isAuthenticated: boolean) => void) | null = null;

const STORAGE_KEY = 'gdrive_auth_token';

function saveToken(token: any) {
    if (token) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(token));
    } else {
        localStorage.removeItem(STORAGE_KEY);
    }
}

function loadSavedToken() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            return null;
        }
    }
    return null;
}

// Initialize gapi client
export async function initGapiClient() {
    await gapi.client.init({
        discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInited = true;

    // Try to restore token
    const savedToken = loadSavedToken();
    if (savedToken) {
        gapi.client.setToken(savedToken);
    }

    checkAuthStatus();
}

// Load gapi script
export function loadGapi() {
    if (gapiInited) return;
    if (typeof gapi === 'undefined') {
        setTimeout(loadGapi, 100);
        return;
    }
    gapi.load('client', initGapiClient);
}

// Initialize GIS client
export function loadGis() {
    if (gisInited) return;
    if (typeof google === 'undefined') {
        setTimeout(loadGis, 100);
        return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse: any) => {
            if (tokenResponse.error !== undefined) {
                console.error("Auth Exception:", tokenResponse.error);
                alert("שגיאה בהתחברות לגוגל. אנא נסה שנית.");
                return;
            }
            saveToken(tokenResponse);
            // Rebuild Procedure: Nuclear reload to guarantee clean OS hardware state (Mic)
            window.location.reload();
        },
    });
    gisInited = true;
}

export function setAuthChangeCallback(callback: (isAuthenticated: boolean) => void) {
    onAuthChangeCallback = callback;
}

function checkAuthStatus() {
    const token = gapi.client.getToken();
    const isAuthenticated = token !== null;

    // Save token for persistence
    if (isAuthenticated) {
        saveToken(token);
    }

    if (onAuthChangeCallback) {
        onAuthChangeCallback(isAuthenticated);
    }
}

export function handleAuthClick() {
    if (!tokenClient) {
        alert("מערכת האימות של גוגל עדיין נטענת... אנא נסה שוב בעוד כמה שניות.");
        return;
    }
    
    // Use select_account as it's more robust for PWA/Mobile context shifts
    // and correctly triggers a fresh interaction if required.
    try {
        const token = gapi.client.getToken();
        if (!token) {
            tokenClient.requestAccessToken({ prompt: 'select_account' });
        } else {
            tokenClient.requestAccessToken({ prompt: '' });
        }
    } catch (e) {
        console.error("Auth request error:", e);
        tokenClient.requestAccessToken({ prompt: 'select_account' });
    }
}

/**
 * Attempts to re-authenticate silently if possible
 */
export function tryReconnect() {
    if (!tokenClient) return;
    tokenClient.requestAccessToken({ prompt: '' });
}

export function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken(null);
            saveToken(null); // Clear storage
            checkAuthStatus();
        });
    } else {
        saveToken(null);
        checkAuthStatus();
    }
}

export function isAuthenticated(): boolean {
    if (!gapiInited) return false;
    return gapi.client.getToken() !== null;
}

// -------------------------------------------------------------
// Drive API Helpers
// -------------------------------------------------------------

async function findOrCreateFolder(): Promise<string> {
    console.log("Drive API: Starting findOrCreateFolder");
    let response;
    try {
        response = await (gapi.client as any).drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        console.log("Drive API: Extracted folder list response", response);
    } catch (err: any) {
        console.error("Error finding folder", err);
        if (err.status === 401 || err.result?.error?.code === 401) {
            handleSignoutClick();
            throw new Error("Google Session Expired. Please reconnect.");
        }
        throw err;
    }

    const files = response.result.files;
    console.log("Drive API: Found folder files matching name", files);
    if (files && files.length > 0) {
        console.log(`Drive API: Folder exists with ID ${files[0].id}`);
        return files[0].id;
    } else {
        console.log("Drive API: Folder does not exist. Attempting to create...");
        try {
            const accessToken = gapi.client.getToken().access_token;
            const metadata = {
                name: FOLDER_NAME,
                mimeType: 'application/vnd.google-apps.folder',
            };
            const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: new Headers({
                    'Authorization': 'Bearer ' + accessToken,
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify(metadata)
            });
            if (!createResponse.ok) {
                const errorData = await createResponse.json();
                console.error("Folder creation failed body:", errorData);
                throw new Error(`Failed to create folder: ${createResponse.statusText}`);
            }
            const data = await createResponse.json();
            console.log("Drive API: Successfully created folder", data);
            return data.id;
        } catch (err) {
            console.error("Error creating folder", err);
            throw err;
        }
    }
}

async function findFileId(folderId: string): Promise<string | null> {
    const response = await (gapi.client as any).drive.files.list({
        q: `'${folderId}' in parents and name='${FILE_NAME}' and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });
    const files = response.result.files;
    if (files && files.length > 0) {
        return files[0].id;
    }
    return null;
}

export async function uploadStateToDrive(state: any): Promise<void> {
    console.log("Drive API: uploadStateToDrive triggered with state length:", state?.length);
    if (!isAuthenticated()) {
        console.log("Drive API: Not authenticated, aborting upload.");
        return;
    }

    try {
        console.log("Drive API: Checking for folder...");
        const folderId = await findOrCreateFolder();
        console.log("Drive API: Checking for file...");
        const existingFileId = await findFileId(folderId);

        console.log("Drive API: Building file payload...");
        const fileContent = JSON.stringify(state);
        const file = new Blob([fileContent], { type: 'application/json' });
        const metadata = {
            name: FILE_NAME,
            mimeType: 'application/json',
            parents: [folderId]
        };

        const accessToken = gapi.client.getToken().access_token;
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', file);

        let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        let method = 'POST';

        if (existingFileId) {
            console.log("Drive API: File exists. Using PATCH to update.");
            url = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`;
            method = 'PATCH';
            // Remove parents from metadata for an update
            delete (metadata as any).parents;
            form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        } else {
            console.log("Drive API: File does not exist. Using POST to create.");
        }

        console.log("Drive API: Executing fetch request...");
        const res = await fetch(url, {
            method: method,
            headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
            body: form,
        });

        if (!res.ok) {
            if (res.status === 401) {
                handleSignoutClick();
                throw new Error(`Google Session Expired. Please reconnect.`);
            }
            
            let errorMsg = res.statusText;
            try {
                const errorData = await res.json();
                console.error("Drive API: Fetch error HTTP body:", errorData);
                if (errorData.error && errorData.error.message) {
                    errorMsg = errorData.error.message;
                }
            } catch (e) {
                // ignore
            }
            throw new Error(`Upload failed: ${errorMsg}`);
        }
        console.log("State successfully synced to Google Drive. Response OK.", res.status);
    } catch (err) {
        console.error("Error uploading to drive", err);
        throw err; // Re-throw to be caught by UI
    }
}

export async function downloadStateFromDrive(): Promise<any | null> {
    if (!isAuthenticated()) return null;

    try {
        const folderId = await findOrCreateFolder();
        const fileId = await findFileId(folderId);

        if (!fileId) return null;

        const response = await (gapi.client as any).drive.files.get({
            fileId: fileId,
            alt: 'media',
        });

        return response.result; // This should be the parsed JSON state
    } catch (err) {
        console.error("Error downloading from drive", err);
        return null;
    }
}
