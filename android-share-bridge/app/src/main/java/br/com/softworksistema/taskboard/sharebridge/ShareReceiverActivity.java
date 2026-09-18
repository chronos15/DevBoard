package br.com.softworksistema.taskboard.sharebridge;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * TaskBoard Share Bridge V224.
 *
 * Não depende do WebAPK/Web Share Target. Recebe ACTION_SEND / ACTION_SEND_MULTIPLE
 * diretamente do Android, monta um multipart comum (o mesmo formato validado via curl)
 * e envia para o endpoint existente do TaskBoard. O 303 retornado pelo servidor é
 * aberto em seguida, reaproveitando o fluxo /compartilhar já existente.
 */
public class ShareReceiverActivity extends Activity {
    private static final String SHARE_ENDPOINT = "https://taskboard.softworksistema.com.br/share-target";
    private static final String CRLF = "\r\n";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        renderStatus("Preparando compartilhamento…");
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        renderStatus("Preparando compartilhamento…");
        handleIntent(intent);
    }

    private void renderStatus(String message) {
        TextView text = new TextView(this);
        text.setText(message);
        text.setTextSize(18f);
        text.setGravity(Gravity.CENTER);
        text.setPadding(32, 32, 32, 32);
        setContentView(text);
    }

    private void handleIntent(Intent intent) {
        new Thread(() -> {
            File multipartFile = null;
            try {
                final List<Uri> uris = collectSharedUris(intent);
                final String title = stringExtra(intent, Intent.EXTRA_SUBJECT);
                final String text = stringExtra(intent, Intent.EXTRA_TEXT);

                if (uris.isEmpty() && isBlank(title) && isBlank(text)) {
                    fail("O Android não entregou nenhum arquivo ou texto ao receptor nativo.");
                    return;
                }

                final String boundary = "----TaskBoardNativeV224-" + UUID.randomUUID();
                multipartFile = createMultipartFile(boundary, uris, title, text);
                final String redirect = postMultipart(boundary, multipartFile);

                if (redirect == null || redirect.trim().isEmpty()) {
                    fail("O servidor recebeu o anexo, mas não retornou o destino do compartilhamento.");
                    return;
                }

                final String finalRedirect = redirect;
                runOnUiThread(() -> openTaskBoard(finalRedirect));
            } catch (Exception ex) {
                fail("Falha ao compartilhar: " + safeMessage(ex));
            } finally {
                if (multipartFile != null && multipartFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    multipartFile.delete();
                }
            }
        }, "TaskBoardShareBridge").start();
    }

    private List<Uri> collectSharedUris(Intent intent) {
        List<Uri> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) {
                for (Uri uri : many) addUri(result, seen, uri);
            }
        } else {
            Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            addUri(result, seen, single);
        }

        ClipData clipData = intent.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                addUri(result, seen, clipData.getItemAt(i).getUri());
            }
        }

        return result;
    }

    private void addUri(List<Uri> result, Set<String> seen, Uri uri) {
        if (uri == null) return;
        String key = uri.toString();
        if (seen.add(key)) result.add(uri);
    }

    private File createMultipartFile(
            String boundary,
            List<Uri> uris,
            String title,
            String text
    ) throws Exception {
        File outFile = File.createTempFile("taskboard-share-v224-", ".multipart", getCacheDir());

        try (DataOutputStream out = new DataOutputStream(
                new BufferedOutputStream(new FileOutputStream(outFile)))) {
            writeTextPart(out, boundary, "title", title);
            writeTextPart(out, boundary, "text", text);

            for (Uri uri : uris) {
                writeFilePart(out, boundary, uri);
            }

            out.writeBytes("--" + boundary + "--" + CRLF);
            out.flush();
        }

        return outFile;
    }

    private void writeTextPart(DataOutputStream out, String boundary, String name, String value)
            throws Exception {
        if (isBlank(value)) return;

        out.writeBytes("--" + boundary + CRLF);
        out.writeBytes("Content-Disposition: form-data; name=\"" + name + "\"" + CRLF);
        out.writeBytes("Content-Type: text/plain; charset=UTF-8" + CRLF);
        out.writeBytes(CRLF);
        out.write(value.getBytes(StandardCharsets.UTF_8));
        out.writeBytes(CRLF);
    }

    private void writeFilePart(DataOutputStream out, String boundary, Uri uri) throws Exception {
        ContentResolver resolver = getContentResolver();
        String filename = sanitizeFilename(queryDisplayName(uri));
        String mime = resolver.getType(uri);
        if (isBlank(mime)) mime = "application/octet-stream";

        out.writeBytes("--" + boundary + CRLF);
        out.writeBytes("Content-Disposition: form-data; name=\"files\"; filename=\""
                + escapeQuoted(filename) + "\"" + CRLF);
        out.writeBytes("Content-Type: " + mime + CRLF);
        out.writeBytes(CRLF);

        try (InputStream raw = resolver.openInputStream(uri)) {
            if (raw == null) throw new IllegalStateException("Não foi possível abrir " + filename);
            try (BufferedInputStream in = new BufferedInputStream(raw)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }
        }

        out.writeBytes(CRLF);
    }

    private String postMultipart(String boundary, File payload) throws Exception {
        URL endpoint = new URL(SHARE_ENDPOINT);
        HttpURLConnection connection = (HttpURLConnection) endpoint.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(60_000);
        connection.setReadTimeout(300_000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        connection.setRequestProperty("Accept", "text/html,application/xhtml+xml,*/*");
        connection.setRequestProperty("User-Agent", "TaskBoardShareBridge/1.0 V224 Android");
        connection.setFixedLengthStreamingMode(payload.length());

        try (OutputStream out = new BufferedOutputStream(connection.getOutputStream());
             InputStream fileIn = new BufferedInputStream(new FileInputStream(payload))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = fileIn.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            out.flush();
        }

        int code = connection.getResponseCode();
        String location = connection.getHeaderField("Location");

        if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
            if (isBlank(location)) {
                throw new IllegalStateException("HTTP " + code + " sem Location.");
            }
            return new URL(endpoint, location).toString();
        }

        if (code >= 200 && code < 300 && !isBlank(location)) {
            return new URL(endpoint, location).toString();
        }

        String body = readResponseBody(connection, code >= 400);
        throw new IllegalStateException("Servidor respondeu HTTP " + code
                + (isBlank(body) ? "" : ": " + body));
    }

    private String readResponseBody(HttpURLConnection connection, boolean error) {
        try {
            InputStream stream = error ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) return "";
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                StringBuilder value = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null && value.length() < 800) {
                    value.append(line).append(' ');
                }
                return value.toString().trim();
            }
        } catch (Exception ignored) {
            return "";
        }
    }

    private void openTaskBoard(String url) {
        try {
            Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(open);
            finish();
        } catch (Exception ex) {
            fail("Anexo recebido, mas não foi possível abrir o TaskBoard: " + safeMessage(ex));
        }
    }

    private String queryDisplayName(Uri uri) {
        if (uri == null) return "anexo";
        if ("content".equalsIgnoreCase(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(
                    uri,
                    new String[]{OpenableColumns.DISPLAY_NAME},
                    null,
                    null,
                    null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index >= 0) {
                        String value = cursor.getString(index);
                        if (!isBlank(value)) return value;
                    }
                }
            } catch (Exception ignored) {
                // Fallback abaixo.
            }
        }
        String last = uri.getLastPathSegment();
        return isBlank(last) ? "anexo" : last;
    }

    private String sanitizeFilename(String value) {
        if (isBlank(value)) return "anexo";
        return value.replace("\r", "_").replace("\n", "_");
    }

    private String escapeQuoted(String value) {
        return value.replace("\\", "_").replace("\"", "'");
    }

    private String stringExtra(Intent intent, String key) {
        Object value = intent.getExtras() == null ? null : intent.getExtras().get(key);
        return value == null ? "" : String.valueOf(value);
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private String safeMessage(Throwable error) {
        String message = error == null ? null : error.getMessage();
        return isBlank(message) ? "erro desconhecido" : message;
    }

    private void fail(String message) {
        runOnUiThread(() -> {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            finish();
        });
    }
}
