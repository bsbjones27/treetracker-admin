/* eslint-disable @typescript-eslint/explicit-module-boundary-types */


import express from 'express';
const router = express.Router();
import jwt from 'jsonwebtoken';
import generator from 'generate-password';
import Crypto from 'crypto';
import bodyParser from 'body-parser';
import config from '../config';
import {Pool} from 'pg';
import {utils} from './utils';
import {helper} from './helper';
const db =
  process.env.NODE_DB === 'test'
    ? require('../datasources/treetrackerTest.datasource.json')
    : require('../datasources/treetracker.datasource.json');
import policy from '../policy.json';
import expect from 'expect';
// import Audit from './Audit';

const app = express();
const pool = new Pool({connectionString: db.url});
const jwtSecret = config.jwtSecret;

const POLICIES = {
  SUPER_PERMISSION: 'super_permission',
  LIST_USER: 'list_user',
  MANAGER_USER: 'manager_user',
  LIST_TREE: 'list_tree',
  APPROVE_TREE: 'approve_tree',
  LIST_PLANTER: 'list_planter',
  MANAGE_PLANTER: 'manage_planter',
};


const sha512 = function (password, salt) {
  const hash = Crypto.createHmac('sha512', salt);
  hash.update(password);
  const hashedPwd = hash.digest('hex');
  return hashedPwd;
};

const generateSalt = function () {
  const generated = generator.generate({length: 6, numbers: true});
  return generated;
};


const jsonParser = app.use(bodyParser.urlencoded({extended: false})); // parse application/json
// const urlencodedParser = app.use(bodyParser.json());/// parse application/x-www-form-urlencoded

router.get('/permissions', async function login(req, res) {
  try {
    const result = await pool.query(`select * from admin_role`);
    res.status(200).json(result.rows.map((r) => utils.convertCamel(r)));
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.post('/login', async function login(req, res, next) {
  try {
    //try to init, in case of first visit
    // await init();
    const {userName, password} = req.body;

    //find the user to get the salt, validate if hashed password matches
    const user_rows = await pool.query(
      `select * from admin_user where user_name = '${userName}'`,
    );

    //Check if user exists
    if (user_rows.rowCount === 0) {
      return res
        .status(401)
        .json({errorMessage: `The username: ${userName} does not exist.`});
    }

    const user_entity = user_rows.rows[0];
    expect(user_entity.salt).toBeDefined();
    const hash = sha512(password, user_entity.salt);
    expect(hash).toBeDefined();

    let result = await pool.query(
      `select * from admin_user where user_name = '${userName}' and password_hash = '${hash}'`,
    );
    let userLogin;
    if (result.rows.length === 1) {
      userLogin = utils.convertCamel(result.rows[0]);
      //load role
      //console.assert(userLogin.id >= 0, 'id?', userLogin);
      result = await pool.query(
        `select * from admin_user_role where admin_user_id = ${userLogin.id}`,
      );
      userLogin.role = result.rows.map((r) => r.role_id);
    } else {
      console.log('can not find user by ', userName);
    }

    // If user exists in db AND user is active
    // query remaining details and return
    if (userLogin && userLogin.active) {
      const userDetails = await loadUserPermissions(userLogin.id);
      userLogin = {...userLogin, ...userDetails};
      //TODO get user
      const token = await jwt.sign(userLogin, jwtSecret);
      const {
        id,
        userName,
        firstName,
        lastName,
        email,
        role,
        policy,
      } = userLogin;
      //      const audit = new Audit();
      //      await audit.did(userLogin.id, Audit.TYPE.LOGIN, req);
      console.log('login success');
      res.json({
        token,
        user: {id, userName, firstName, lastName, email, role, policy},
      });
    } else {
      console.log('login failed:', userLogin);
    }

    return res.status(401).json();
  } catch (err) {
    console.error(err);
    next(err);
  }
});

// load roles and policy (permissions)
async function loadUserPermissions(userId) {
  const userDetails = {};
  let result;
  //get role
  result = await pool.query(
    `select * from admin_user_role where admin_user_id = ${userId}`,
  );
  expect(result.rows.length).toBeGreaterThan(0);
  userDetails.role = result.rows.map((r) => r.role_id);
  //get policies
  result = await pool.query(
    `select * from admin_role where id = ${userDetails.role[0]}`,
  );
  userDetails.policy = result.rows.map((r) => r.policy)[0];
  return userDetails;
}

router.get('/test', async function login(req, res) {
  res.send('OK');
});

router.get('/admin_users/:userId', async (req, res) => {
  try {
    //console.log(pool);
    let result = await pool.query(
      `select * from admin_user where id=${req.params.userId}`,
    );
    let userGet;
    if (result.rows.length === 1) {
      userGet = utils.convertCamel(result.rows[0]);
      //load role
      result = await pool.query(
        `select * from admin_user_role where role_id = ${userGet.id}`,
      );
      userGet.role = result.rows.map((r) => r.role_id);
    }
    if (userGet) {
      res.status(200).json(userGet);
    } else {
      res.status(404).json();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.put('/admin_users/:userId/password', jsonParser, async (req, res) => {
  try {
    const salt = generateSalt();
    const hash = sha512(req.body.password, salt);
    await pool.query(
      `update admin_user set password_hash = '${hash}', salt = '${salt}' where id = ${req.params.userId}`,
    );
    res.status(200).json();
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.patch('/admin_users/:userId', async (req, res) => {
  try {
    const update = `update admin_user set ${utils.buildUpdateFields(
      req.body,
    )} where id = ${req.params.userId}`;
    console.log('update:', update);
    await pool.query(update);
    //role
    await pool.query(
      `delete from admin_user_role where admin_user_id = ${req.params.userId}`,
    );
    if (req.body.role) {
      for (let i = 0; i < req.body.role.length; i++) {
        await pool.query(
          `insert into admin_user_role (role_id, admin_user_id) values (${req.body.role[i]},${req.params.userId})`,
        );
      }
    }
    res.status(200).json();
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.delete('/admin_users/:userId', async (req, res) => {
  try {
    let deleteQuery = `delete from admin_user_role where admin_user_id = ${req.params.userId}`;
    console.log('delete:', deleteQuery);
    await pool.query(deleteQuery);
    deleteQuery = `delete from admin_user where id = ${req.params.userId}`;
    console.log('delete:', deleteQuery);
    await pool.query(deleteQuery);
    res.status(204).json();
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.get('/admin_users/', async (req, res) => {
  try {
    const result = await pool.query(`select * from admin_user`);
    const users = [];
    for (let i = 0; i < result.rows.length; i++) {
      const r = result.rows[i];
      const roles = await pool.query(
        `select * from admin_user_role where admin_user_id = ${r.id}`,
      );
      r.role = roles.rows.map((rr) => rr.role_id);
      users.push(utils.convertCamel(r));
    }
    res.status(200).json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

router.post('/validate/', async (req, res) => {
  try {
    const {password} = req.body;
    const token = req.headers.authorization;
    const decodedToken = jwt.verify(token, jwtSecret);
    const userSession = decodedToken;
    const hash = sha512(password, userSession.salt);

    if (hash === userSession.passwordHash) {
      return res.status(200).json();
    } else {
      return res.status(401).json();
    }
  } catch (err) {
    console.error(
      err,
      'verify, req:',
      req.originalUrl,
      req.headers.authorization,
    );
    res.status(500).json();
  }
});

router.post('/admin_users/', async (req, res) => {
  try {
    req.body.passwordHash = req.body.password;
    delete req.body.password;
    let result = await pool.query(
      `select * from admin_user where user_name = '${req.body.userName}'`,
    );
    if (result.rows.length === 1) {
      //TODO 401
      res.status(201).json({id: result.rows[0].id});
      return;
    }
    //active
    if (req.body.active == undefined) {
      req.body.active = true;
    }
    const insert = `insert into admin_user ${utils.buildInsertFields(
      req.body,
    )}`;
    console.log('insert:', insert);
    await pool.query(insert);
    result = await pool.query(
      `select * from admin_user where user_name = '${req.body.userName}'`,
    );
    let obj;
    if (result.rows.length === 1) {
      obj = result.rows[0];
      //roles
      //role
      await pool.query(
        `delete from admin_user_role where admin_user_id = ${obj.id}`,
      );
      for (let i = 0; i < req.body.role.length; i++) {
        const insertRole = `insert into admin_user_role (role_id, admin_user_id) values (${req.body.role[i]},${obj.id})`;
        console.log('insert role:', insertRole);
        await pool.query(insertRole);
      }
    } else {
      throw new Error('can not find new user');
    }
    res.status(201).json({id: obj.id});
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

async function init() {
  console.log('Begin init...');
  const result = await pool.query(`select * from admin_user `);

  if (result.rows.length > 0) {
    console.log('There are accounts in admin user, quit.');
    return;
  }
  console.log('clean...');
  await pool.query('delete from admin_user');
  await pool.query('delete from admin_user_role');
  await pool.query('delete from admin_role');

  await pool.query(
    `insert into admin_role (id, role_name, description, policy) ` +
      `values (1, 'Admin', 'The super administrator role, having all permissions','${JSON.stringify(
        [policy.policies[0], policy.policies[1], policy.policies[2]],
      )}'),` +
      `(2, 'Tree Manager', 'Check, verify, manage trees','${JSON.stringify([
        policy.policies[3],
        policy.policies[4],
      ])}'),` +
      `(3, 'Planter Manager', 'Check, manage planters','${JSON.stringify([
        policy.policies[5],
        policy.policies[6],
      ])}')`,
  );

  await pool.query(
    `insert into admin_user (id, user_name, first_name, last_name, password_hash, salt, email, active) ` +
      `values ( 1, 'admin', 'Admin', 'Panel', 'eab8461725c44aa1532ed88de947fe0706c00c31ed6d832218a6cf59d7602559a7d372d42a64130f21f1f33091105548514bca805b81ee1f01a068a7b0fa2d80', 'OglBTs','admin@greenstand.org', true),` +
      `(2, 'test', 'Admin', 'Test', '539430ec2a48fd607b6e06f3c3a7d3f9b46ac5acb7e81b2633678a8fe3ce6216e2abdfa2bc41bbaa438ba55e5149efb7ad522825d9e98df5300b801c7f8d2c86', 'WjSO0T','test@greenstand.org', true)`,
  );
  await pool.query(
    `insert into admin_user_role (id, role_id, admin_user_id) ` +
      `values ( 1, 1, 1), ` +
      `(2, 2, 2), ` +
      `(3, 3, 2)`,
  );
}

router.post('/init', async (req, res) => {
  try {
    await init();
    res.status(200).json();
  } catch (e) {
    console.error(e);
    res.status(500).json();
  }
});

const isAuth = async (req, res, next) => {
  //white list
  console.log('testtest');
  const url = req.originalUrl;
  const isDevEnvironment = utils.getEnvironment() === 'development';
  const isApiExplorerReq = isDevEnvironment;
  if (
    url === '/auth/login' ||
    url === '/auth/test' ||
    url === '/auth/init' ||
    isApiExplorerReq
  ) {
    next();
    return;
  }
  try {
    const token = req.headers.authorization;
    const decodedToken = jwt.verify(token, jwtSecret);
    const userSession = decodedToken;
    //inject the user extract from token to request object
    req.user = userSession;
    // const roles = userSession.role;
    expect(userSession.policy).toBeInstanceOf(Object);
    const policies = userSession.policy.policies;
    expect(policies).toBeInstanceOf(Array);
    const organization = userSession.policy.organization;
    organization &&
      expect(organization).toMatchObject({
        name: expect.any(String),
        id: expect.any(Number),
      });
    let matcher;
    if (url.match(/\/auth\/check_session/)) {
      const user_id = req.query.id;
      console.log(user_id);
      const result = await pool.query(
        `select * from admin_user where id = '${user_id}'`,
      );
      if (result.rows.length === 1) {
        const update_userSession = utils.convertCamel(result.rows[0]);
        //compare wuth the updated pwd in case pwd is changed
        if (update_userSession.passwordHash === userSession.passwordHash) {
          /*get the role for updated usersession* */
          const updated_role = await pool.query(
            `select * from admin_user_role where admin_user_id = ${user_id}`,
          );
          update_userSession.role = updated_role.rows.map((r) => r.role_id);
          //compare wuth the updated role in case role is changed
          if (helper.needRoleUpdate(update_userSession, userSession)) {
            //reassign token with updated role if role changes
            const new_token = jwt.sign(update_userSession, jwtSecret);
            res.status(200).json({token: new_token});
            return;
          } else {
            console.log('auth check');
            /*no role change */
            res.status(200).json({});
            return;
          }
        } else {
          console.log('password unmatch');
          res.status(401).json({
            error: new Error('Session expired'),
          });
          return;
        }
      }
    }
    if (url.match(/\/auth\/(?!login).*/)) {
      //if role is admin, then can do auth stuff
      // if (userSession.role.some(r => r === PERMISSIONS.ADMIN)) {
      //   next();
      //   return;
      // }
      if (policies.some((r) => r.name === POLICIES.SUPER_PERMISSION)) {
        next();
        return;
      } else {
        console.log('No permission');
        res.status(401).json({
          error: new Error('No permission'),
        });
        return;
      }
    } else if (url.match(/\/api\/.*/)) {
      if (url.match(/\/api\/species.*/)) {
        return next();
      } else if (url.match(/\/api\/tags.*/)) {
        return next();
      } else if (url.match(/\/api\/tree_tags.*/)) {
        return next();
      }
      matcher = url.match(/\/api\/(organization\/(\d+)\/)?trees.*/);
      if (matcher) {
        if (matcher[1]) {
          //organization case
          if (
            policies.some(
              (r) =>
                r.name === POLICIES.SUPER_PERMISSION ||
                r.name === POLICIES.LIST_TREE ||
                r.name === POLICIES.APPROVE_TREE,
            )
          ) {
            return next();
          } else {
            res.status(401).json({
              error: new Error('No permission'),
            });
            return;
          }
        } else {
          //normal case
          //organizational user can not visit it directly
          if (organization && organization.id > 0) {
            res.status(401).json({
              error: new Error('No permission'),
            });
            return;
          }
          if (
            policies.some(
              (r) =>
                r.name === POLICIES.SUPER_PERMISSION ||
                r.name === POLICIES.LIST_TREE ||
                r.name === POLICIES.APPROVE_TREE,
            )
          ) {
            return next();
          } else {
            res.status(401).json({
              error: new Error('No permission'),
            });
            return;
          }
        }
      }

      matcher = url.match(/\/api\/(organization\/(\d+)\/)?planter.*/);
      if (matcher) {
        if (matcher[1]) {
          //organization case
          if (
            policies.some(
              (r) =>
                r.name === POLICIES.SUPER_PERMISSION ||
                r.name === POLICIES.LIST_PLANTER ||
                r.name === POLICIES.MANAGE_PLANTER,
            )
          ) {
            return next();
          } else {
            res.status(401).json({
              error: new Error('No permission'),
            });
            return;
          }
        } else {
          //normal case
          //organizational user can not visit it directly
          if (organization && organization.id > 0) {
            res.status(401).json({
              error: new Error('No permission'),
            });
            return;
          } else {
            if (
              policies.some(
                (r) =>
                  r.name === POLICIES.SUPER_PERMISSION ||
                  r.name === POLICIES.LIST_PLANTER ||
                  r.name === POLICIES.MANAGE_PLANTER,
              )
            ) {
              return next();
            } else {
              res.status(401).json({
                error: new Error('No permission'),
              });
              return;
            }
          }
        }
      }
    } else {
      return next();
    }
    res.status(401).json({
      error: new Error('No permission'),
    });
    //res.status(200).json([user]);
  } catch (e) {
    console.warn(e);
    res.status(401).json({
      error: new Error('Invalid request!'),
    });
  }
};

export default {
  router,
  isAuth,
};
