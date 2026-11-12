package com.banta.canonsync;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// API keys and sign-in tokens, kept in secrets.json encrypted with an AES key that lives in the Android Keystore.
// The key can't be copied off the phone, so secrets.json is also left out of Android's backups (backup_rules.xml).
final class Secrets {
    static final String ALIAS = "saga_secrets";
    static final String FILE = "secrets.json";

    private Secrets() {
    }

    static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, 3) // encrypt | decrypt
                .setBlockModes("GCM").setEncryptionPaddings("NoPadding").setKeySize(256).build());
        return g.generateKey();
    }

    // "" when nothing is stored yet, null when the Keystore can't be used (the page then keeps keys the old way)
    static String load(Context ctx) {
        try {
            SecretKey k = key();
            File f = new File(ctx.getFilesDir(), FILE);
            if (!f.exists() || f.length() == 0) return "";
            byte[] all = Bridge.readAll(new FileInputStream(f));
            String[] parts = new String(all, "UTF-8").trim().split(":");
            if (parts.length != 2) return "";
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, Base64.getDecoder().decode(parts[0])));
            return new String(c.doFinal(Base64.getDecoder().decode(parts[1])), "UTF-8");
        } catch (Throwable t) {
            return null;
        }
    }

    static boolean save(Context ctx, String text) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] enc = c.doFinal(text.getBytes("UTF-8"));
            String out = Base64.getEncoder().encodeToString(c.getIV()) + ":" + Base64.getEncoder().encodeToString(enc);
            File dir = ctx.getFilesDir(), tmp = new File(dir, FILE + ".tmp");
            FileOutputStream o = new FileOutputStream(tmp);
            o.write(out.getBytes("UTF-8"));
            o.close();
            return tmp.renameTo(new File(dir, FILE));
        } catch (Throwable t) {
            return false;
        }
    }
}
