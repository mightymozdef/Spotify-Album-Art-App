const http = require('http');
const https = require('https');
const fs = require('fs');
const url = require('url');
const path = require('path');
const querystring = require('querystring');

const credentials = require('./auth/credentials.json');
const authentication_cache = './auth/authentication-res.json';

const server_address = '127.0.0.1';
const port = 3000;

// album_dir used as the location of the directory for where the album art will be saved
var album_dir = __dirname + '/album-art';

// check to see if the folder exists - if not create it
if (!fs.existsSync(album_dir)) {
    fs.mkdirSync(album_dir);
    console.log(`Album art directory created at ${album_dir}`);
}

let server = http.createServer((req, res) => {

    if (req.url === '/') {
        let search_stream = fs.createReadStream('./html/search-form.html', 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        search_stream.pipe(res);
    } else if (req.url.startsWith('/favicon.ico')) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end();
    } else if (req.url.startsWith('/album-art/')) {
        let album_path = `./album-art/${req.url.slice(req.url.lastIndexOf("/") + 1)}`,
            image_stream = fs.createReadStream(album_path);
        image_stream.on('error', err => {
            console.log(err);
            res.writeHead(404);
            return res.end();
        });
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        image_stream.pipe(res);
    } else if (req.url.startsWith('/search')) {
        const user_input = url.parse(req.url, true).query.q;

        const post_data = querystring.stringify({
            'client_id': credentials.client_id,
            'client_secret': credentials.client_secret,
            grant_type: 'client_credentials'
        });

        const options = {
            'method': 'POST',
            'headers': {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': post_data.length
            }
        };

        const received_authentication = (authentication_res, user_input, auth_sent_time, res) => {
            authentication_res.setEncoding("utf8");
            let body = "";
            authentication_res.on("data", chunk => { body += chunk; });
            authentication_res.on("end", () => {
                let spotify_auth = JSON.parse(body);
                console.log(`Spotify Authentication Request: ${body}`);
                Object.defineProperty(spotify_auth, "expiration", { value: new Date(3600000 + auth_sent_time.getTime()) });
                console.log(`${auth_sent_time} => cache will expire one hour later at this time: => ${spotify_auth.expiration}`);
                create_access_token_cache(spotify_auth);
                create_search_req(spotify_auth, user_input, res);
            });
        };

        const create_access_token_cache = spotify_auth => {
            fs.writeFile(authentication_cache, JSON.stringify(spotify_auth), err => {
                if (err) { console.log(err); }
            });
        };

        const create_search_req = (spotify_auth, user_input, res) => {
            const token_endpoint = "https://api.spotify.com/v1/search",
                access_token = spotify_auth.access_token,
                type = "album",
                q = user_input;
            const request = `${token_endpoint}?type=${type}&q=${q}&access_token=${access_token}`;

            const req = https.request(request, res => {
                console.log(`Sending Spotify API Request: Searching for ${q}...`);
                album_art_retrieval(res);
            });

            const album_art_retrieval = res => {
                let downloaded_images = 0, img_url_arr = [], body = "";
                console.log("Downloading Images To /album-art/ ...");
                res.setEncoding('utf8');
                res.on("error", err => { console.log(err); });
                res.on("data", chunk => { body += chunk; });
                res.on("end", () => {
                    let spotify_json_response = JSON.parse(body);
                    for (let i = 0; i < Object.keys(spotify_json_response.albums.items).length; i++) {
                        let url = spotify_json_response.albums.items[i].images[1].url; //used images[1] instead because the pictures are more appropriately sized
                        fs.access(`./album-art/${url.slice(url.lastIndexOf("/") + 1)}.jpg`, () => {
                            let image_req = https.get(url, image_res => {
                                console.log(`Image Request Was Made To: /album-art/${url.slice(url.lastIndexOf("/") + 1)}.jpg `);
                                let new_img = fs.createWriteStream(`./album-art/${url.slice(url.lastIndexOf("/") + 1)}.jpg`, { 'encoding': null });
                                image_res.pipe(new_img);
                                img_url_arr.push(`./album-art/${url.slice(url.lastIndexOf("/") + 1)}.jpg`);
                                new_img.on("finish", () => {
                                    downloaded_images++;
                                    if (downloaded_images === Object.keys(spotify_json_response.albums.items).length) {
                                        console.log("Downloading Album Art Finished!");
                                        generate_webpage(img_url_arr);
                                    }
                                });
                            });
                            image_req.end();
                        }); //fs.access end
                    } //for loop end
                }); //res.on(end) end
            }; //downloading album art function end
            req.end();
        }; // create_search_req end

        let cache_valid = false;

        if (fs.existsSync(authentication_cache)) {
            cached_auth = require(authentication_cache);
            if (new Date(cached_auth.expiration) > Date.now()) {
                cache_valid = true;
            }
            else {
                console.log("Token Expired");
            }
        }

        if (cache_valid) {
            console.log("The Authentication Cache Is Still Valid");
            create_search_req(cached_auth, user_input, res);
        }

        else {
            const token_endpoint = 'https://accounts.spotify.com/api/token';
            let auth_sent_time = new Date();
            let authentication_req = https.request(token_endpoint, options, authentication_res => {
                console.log("Receiving Authentication Request From Spotify...");
                received_authentication(authentication_res, user_input, auth_sent_time, res);
            });
            authentication_req.on('error', (err) => {
                console.log(err);
            });
            console.log("Requesting Token...");
            authentication_req.end(post_data);
        }

        const generate_webpage = img_url_arr => {
            console.log('Generating Webpage');
            let webpage = `<h1>Search Results For: ${user_input}</h1>`;
            const img_arr = img_url_arr.map((url) => {
                return `<img src="${url}">`
            });
            const imgs = img_arr.join();
            webpage += `<p>${imgs}</p>`;
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.write(webpage);
            res.end();
        };

    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end();
    }
});

server.listen(port, server_address);
console.log(`Now Listening On ${server_address}:${port}`);
console.log("Restart Server After Making Search Requests To Delete Caches");

server.close();

if (fs.existsSync(authentication_cache)) {
    const album_path = "./album-art/";
    server.on('close', () => {
        fs.unlink(authentication_cache, err => {
            if (err) { console.log(err); }
            console.log("Deleted Authentication Cache File");
        });
        fs.readdir(album_path, (err, images) => {
            if (err) { console.log(err); }
            for (const image of images) {
                fs.unlink(path.join(album_path, image), err => {
                    if (err) { console.log(err); }
                });
            }
            console.log("Cleared Album Art Image Cache");
        });
    });
}